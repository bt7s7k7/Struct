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

    public async notifyMutation(mutation: StructSyncMessages.AnyMutateMessage) {
        for (const middleware of this.server.middleware) {
            const ret = await middleware.options.onOutgoing?.(this.server, this, mutation)
            if (ret != null) {
                mutation = ret
            }
        }

        if (mutation.target in this.tracked) {
            await this.messageBridge.sendRequest("StructSync:proxy_message", mutation).catch(err => {
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
                    for (const middleware of this.server.middleware) {
                        const ret = await middleware.options.onIncoming?.(this.server, this, msg)
                        if (ret != null) {
                            return ret
                        }
                    }

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
