import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { EventListener } from "../eventLib/EventListener"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

export class StructSyncSession extends EventListener {
    public readonly server = DIContext.current.inject(StructSyncServer)
    public readonly onError = new EventEmitter<Error>()

    public [DISPOSE]() {
        super[DISPOSE]()

        this.server.attachSession(this, "remove")
    }

    public async notifyMutation(mutation: StructSyncMessages.AnyMutateMessage) {
        await this.sendMessage(mutation)
    }

    public async emitEvent(event: StructSyncMessages.EventMessage) {
        await this.sendMessage(event)
    }

    protected async sendMessage(message: StructSyncMessages.AnyProxyMessage) {
        for (const middleware of this.server.middleware) {
            const ret = await middleware.options.onOutgoing?.(this.server, this, message)
            if (ret != null) {
                message = ret
            }
        }

        if (message.type != "meta") {
            if (message.target in this.tracked) {
                await this.messageBridge.sendRequest("StructSync:proxy_message", message).catch(err => {
                    this.onError.emit(new Error(`Client of session ${JSON.stringify(this.sessionName)} failed to perform mutation: ${err}`))
                })
            }
        }
    }

    protected tracked: Record<string, StructController> = {}

    constructor(
        public readonly messageBridge: MessageBridge = DIContext.current.inject(MessageBridge),
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
                        return this.server.find(msg.target).runAction(msg.action, msg.argument)
                    } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                })
            }
        })
    }
}
