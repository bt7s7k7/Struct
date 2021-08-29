import { Request, Response } from "express"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { StructSyncMessages } from "../structSync/StructSyncMessages"
import { StructSyncSession } from "../structSync/StructSyncSession"

export class StructSyncExpress extends MessageBridge {
    public readonly session!: StructSyncSession

    public handler = (req: Request, res: Response) => {
        return (async () => {
            if (req.url == "/") {
                res.status(200)
                res.contentType("html")
                res.end(TEST_PAGE)

                return
            }

            if (!this.session) {
                Object.assign(this, { session: this.context.instantiate(() => new StructSyncSession(this)) })
            }

            const data: Record<string, any> = {}

            const url = req.url.substr(1)
            const [pointer, query] = url.split("?")
            const [target, action] = pointer.split("/")

            if (query) {
                for (const segment of query.split("&")) {
                    const [key, value] = segment.split("=")
                    if (key && value) data[key] = value
                }
            }

            const id = (this.nextID++).toString()
            if (req.body && typeof req.body == "object") {
                Object.assign(data, req.body)
            }

            if (!target) {
                res.status(400)
                res.end("Missing target, expected `./:target`")
                return
            }

            const meta: Record<string, any> = {}
            for (const key of Object.keys(data)) {
                if (key[0] == "_") {
                    meta[key] = data[key]
                    delete data[key]
                }
            }

            if (!action) {
                const type = target.split("::")[0]
                if (this.options.blacklist?.find(v => type == v)) {
                    res.status(403)
                    res.end(`Getting content of "${type}" is blacklisted`)
                    return
                }

                this.onMessage.emit({
                    direction: "request",
                    data: {
                        type: "find",
                        track: false,
                        target,
                        ...meta
                    } as StructSyncMessages.FindControllerMessage,
                    id, type: "StructSync:controller_message"
                })

                const response = await new Promise<MessageBridge.Response>(resolve => this.pending[id] = resolve)

                if (response.data) {
                    res.status(200)
                    res.json(response.data)
                } else {
                    res.status(404)
                    res.end(response.error)
                }

                return

            } else {
                this.onMessage.emit({
                    direction: "request",
                    data: {
                        type: "action",
                        target, action,
                        argument: Object.keys(data).length == 0 ? null : data,
                        ...meta
                    } as StructSyncMessages.ActionCallMessage,
                    id, type: "StructSync:controller_message"
                })

                const response = await new Promise<MessageBridge.Response>(resolve => this.pending[id] = resolve)

                if (response.error) {
                    res.status(400)
                    res.end(response.error)
                } else {
                    res.status(200)
                    res.json(
                        typeof response.data == "object" && response.data ? Object.fromEntries(Object.entries(response.data).filter(([key]) => key[0] != "_"))
                            : response.data
                    )
                }

                return
            }
        })().catch(err => {
            // eslint-disable-next-line no-console
            console.error(err)
            res.status(500)
            res.end("Internal server error")
        })
    }

    public async sendMessage(message: MessageBridge.Message) {
        this.pending[message.id](message as MessageBridge.Response)

        delete this.pending[message.id]
    }

    protected nextID = 0;

    protected pending: Record<string, (v: MessageBridge.Response) => void> = {}

    constructor(
        protected readonly options: { blacklist?: string[] } = {}
    ) { super() }
}

const TEST_PAGE = `
<!DOCTYPE html>
<html>

<head>
    <meta charset='utf-8'>
    <meta http-equiv='X-UA-Compatible' content='IE=edge'>
    <title>SSE Test Page</title>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        * {
            position: relative;
            box-sizing: border-box;
        }

        body {
            width: 100vw;
            height: 100vh;
            padding: 8px;
            margin: 0;
            display: flex;
            flex-direction: column;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        .flex {
            display: flex;
            gap: 8px;
        }

        .row {
            flex-direction: row;
        }

        .column {
            flex-direction: column;
        }

        .flex-fill {
            flex: 1 1;
        }

        .content {
            display: contents;
        }

        .hidden {
            display: none;
        }

        textarea {
            resize: none;
            width: 100%;
            height: 100%;
        }
    </style>
</head>

<body>
    <div class="flex column flex-fill">
        <div class="flex row">
            <div>
                Type:
            </div>
            <select id="requestType" onchange="updateRequestType()">
                <option value="find">Find</option>
                <option value="action" selected>Action</option>
            </select>
            <div id="controllerFieldParent" class="content">
                <div>Controller:</div>
                <input type="text" id="controllerField" class="flex-fill">
                <div>ID:</div>
                <input type="text" id="controllerIDField" class="flex-fill">
            </div>
            <div id="actionFieldParent" class="content">
                <div>Action:</div>
                <input type="text" id="actionField" class="flex-fill">
            </div>
        </div>
        <div class="flex-fill">
            <textarea id="bodyField"></textarea>
        </div>
        <div class="flex row">
            <button onclick="doRequest()">Request</button>
            <div id="loading">
                Loading...
            </div>
        </div>
        <div class="flex-fill">
            <textarea id="responseField" readonly></textarea>
        </div>
    </div>

    <script>
        function getInput() {
            return {
                /** @type {string} */
                requestType: document.getElementById("requestType").value,
                /** @type {string} */
                controller: document.getElementById("controllerField").value,
                /** @type {string} */
                controllerID: document.getElementById("controllerIDField").value,
                /** @type {string | null} */
                action: state.actionVisible ? document.getElementById("actionField").value : null,
                /** @type {string} */
                body: document.getElementById("bodyField").value
            }
        }

        /** @type {{ actionVisible: boolean, loadingVisible: boolean, response: string }} */
        const state = {
            actionVisible: true,
            loadingVisible: false,
            response: ""
        }

        function setState( /** @type {Partial<typeof state>} */ newState) {
            Object.assign(state, newState)

            document.getElementById("actionFieldParent").classList[state.actionVisible ? "remove" : "add"]("hidden")
            document.getElementById("loading").classList[state.loadingVisible ? "remove" : "add"]("hidden")
            if (state.response != null) document.getElementById("responseField").value = state.response
        }

        function updateRequestType() {
            const input = getInput()

            setState({ actionVisible: input.requestType == "action" })
        }

        function doRequest() {
            const input = getInput()

            let url = location.href
            if (url[url.length - 1] != "/") url += "/"
            url += input.controller
            if (input.controllerID) url += "::" + input.controllerID
            if (input.action) url += "/" + input.action

            let body = null

            try {
                body = input.body ? JSON.parse(input.body) : null
            } catch (err) {
                setState({ response: err.message })
                return
            }

            setState({ loadingVisible: true })

            /** @type {Response} */
            let response

            fetch(url, {
                body: JSON.stringify(body),
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                }
            }).then(_response => {
                response = _response
                return response.text()
            }).then(data => {
                try {
                    data = JSON.parse(data)
                } catch {}

                const responseText = [
                    response.status + " " + response.statusText,
                    ...[...response.headers.entries()].map(([key, value]) => key + ": " + value),
                    "",
                    typeof data == "string" ? data : JSON.stringify(data, null, 4)
                ]

                setState({ response: responseText.join("\\n") })
            }).finally(() => {
                setState({ loadingVisible: false })
            }) 
        }

        window.addEventListener("load", () => {
            setState({})
        })
    </script>
</body>

</html>
`