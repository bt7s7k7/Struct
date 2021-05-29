import { Request, Response } from "express"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { StructSyncMessages } from "../structSync/StructSyncMessages"
import { StructSyncSession } from "../structSync/StructSyncSession"

export class StructSyncExpress extends MessageBridge {
    public readonly session!: StructSyncSession

    public handler = (req: Request, res: Response) => {
        return (async () => {
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

            if (!action) {
                this.onMessage.emit({
                    direction: "request",
                    data: {
                        type: "find",
                        track: false,
                        target
                    } as StructSyncMessages.FindControllerMessage,
                    id, type: "StructSync:controller_message"
                })

                const response = await new Promise<MessageBridge.Response>(resolve => this.pending[id] = resolve)

                if (response.data) {
                    res.status(200)
                    res.json(Object.fromEntries(Object.entries(response.data).filter(([key]) => key[0] != "_")))
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
                        argument: data
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
}