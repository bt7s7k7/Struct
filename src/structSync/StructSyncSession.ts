import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { EventListener } from "../eventLib/EventListener"
import { WeakRef } from "../eventLib/SharedRef"
import { Struct } from "../struct/Struct"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

export class StructSyncSession extends EventListener {
    public readonly server = DIContext.current.inject(StructSyncServer)
    public readonly onError = new EventEmitter<Error>()
    public readonly onBeforeDispose = new EventEmitter()

    protected readonly defaultServices = new Map<string, WeakRef<StructController>>()

    public [DISPOSE]() {
        this.onBeforeDispose.emit()

        super[DISPOSE]()
        this.server.attachSession(this, "remove")
    }

    public async notifyMutation(mutation: StructSyncMessages.MutateMessage) {
        await this.sendMessage(mutation)
    }

    public async emitEvent(event: StructSyncMessages.EventMessage) {
        await this.sendMessage(event)
    }

    public setDefaultService(controller: StructController, id = Struct.getBaseType(controller).name) {
        this.defaultServices.set(id, controller.getWeakRef())
    }

    protected async sendMessage(message: StructSyncMessages.AnyProxyMessage) {
        for (const middleware of this.server.middleware) {
            const ret = await middleware.options.onOutgoing?.(this.server, this, message)
            if (ret != null) {
                message = ret
            }
        }

        if (message.type != "meta") {
            // Only send message if the target is tracked or if it's a singleton (does not have an id, tracked by default)
            if (message.target in this.tracked || !message.target.includes("::")) {
                await this.messageBridge.sendRequest("StructSync:proxy_message", message).catch(err => {
                    if (!err.message.includes("MessageBridge disposed")) {
                        this.onError.emit(new Error(`Client of session ${JSON.stringify(this.sessionName)} failed to perform mutation: ${err}`))
                    }
                })
            }
        }
    }

    protected findController(id: string) {
        const ref = this.defaultServices.get(id)
        if (ref) {
            if (ref.alive) {
                return ref.value
            } else {
                this.defaultServices.delete(id)
            }
        }

        return this.server.find(id)
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
                    const metaHandle = {
                        server: this.server,
                        session: this
                    } as any as StructSyncMessages.MetaHandle

                    for (const middleware of this.server.middleware) {
                        const ret = await middleware.options.onIncoming?.(this.server, this, msg, metaHandle)
                        if (ret != null) {
                            return ret
                        }
                    }

                    if (msg.type == "find") {
                        const controller = this.findController(msg.target)
                        if (msg.track) this.tracked[msg.target] = controller
                        return controller.serialize()
                    } else if (msg.type == "action") {
                        return this.findController(msg.target).runAction(msg.action, msg.argument, metaHandle)
                    } else if (msg.type == "meta") {
                        // Ignore
                    } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                })
            }
        })
    }
}
