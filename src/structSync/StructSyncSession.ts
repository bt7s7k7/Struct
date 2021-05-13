import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE } from "../eventLib/Disposable"
import { EventListener } from "../eventLib/EventListener"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

export class StructSyncSession extends EventListener {
    public readonly server = DIContext.current.inject(StructSyncServer)

    public [DISPOSE]() {
        super[DISPOSE]()

        this.server.attachSession(this, "remove")
    }

    public notifyMutation(mutation: StructSyncMessages.AnyMutateMessage) {
        if (mutation.target in this.tracked) {
            this.messageBridge.sendRequest("StructSync:proxy_message", mutation).catch(err => {
                // eslint-disable-next-line no-console
                console.error(new Error(`Client of session ${JSON.stringify(this.sessionName)} failed to perform mutation: ${err}`))
            })
        }
    }

    protected tracked: Record<string, StructController> = {}

    constructor(
        public readonly messageBridge: MessageBridge,
        public readonly sessionName = ""
    ) {
        super()

        this.server.attachSession(this)

        this.messageBridge.onRequest.add(this, msg => {
            if (msg.type == "StructSync:controller_message") {
                msg.handle(async (msg: StructSyncMessages.AnyControllerMessage) => {
                    if (msg.type == "find") {
                        const controller = this.server.find(msg.target)
                        if (msg.track) this.tracked[msg.target] = controller
                        return controller.serialize()
                    } else if (msg.type == "action") {
                        this.server.find(msg.target).runAction(msg.action, msg.argument)
                    } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                })
            }
        })
    }
}
