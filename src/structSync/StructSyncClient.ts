import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DIService } from "../dependencyInjection/DIService"
import { DISPOSE } from "../eventLib/Disposable"
import { EventListener } from "../eventLib/EventListener"
import { MetaMessageType } from "./MetaMessageType"
import { MutationUtil } from "./MutationUtil"
import { StructProxy } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"

export class StructSyncClient extends DIService.define() {

    public [DISPOSE]() {
        super[DISPOSE]()

        this.middleware.forEach(v => v.dispose())
    }

    public use(middleware: StructSyncClient.Middleware) {
        this.middleware.push(middleware)
    }

    public register(target: string, controller: StructProxy) {
        this.tracked.add(controller)

        void (this.trackedLookup[target] = (this.trackedLookup[target] ?? new Set())).add(controller)
    }

    public unregister(target: string, controller: StructProxy) {
        if (this.tracked.delete(controller)) {
            const set = this.trackedLookup[target]
            set.delete(controller)
            if (set.size == 0) delete this.trackedLookup[target]
        }
    }

    public async find(context: DIContext, target: string, ctor: any, track: boolean) {
        const data = await this.sendMessage({
            type: "find",
            target, track
        })

        const proxy = context.instantiate(() => ctor.deserialize(data))

        if (track) this.register(target, proxy)

        return proxy
    }

    public async runAction(target: string, action: string, argument: any) {
        return await this.sendMessage({
            type: "action",
            action, argument, target
        })
    }

    public async sendMessage(message: StructSyncMessages.AnyControllerMessage) {
        for (const middleware of this.middleware) {
            const ret = await middleware.options.onOutgoing?.(this, message)
            if (ret != null) {
                message = ret
            }
        }

        return await this.messageBridge.sendRequest("StructSync:controller_message", message)
    }

    public async sendMetaMessage<K extends string, T, R>(type: MetaMessageType<K, T, R>, data: T): Promise<R> {
        const response = await this.sendMessage({ type: "meta", name: type.name, data: type.argument.serialize(data) })
        return type.result.deserialize(response)
    }

    protected messageBridge = this.context.inject(MessageBridge)
    protected tracked = new Set<StructProxy>()
    protected trackedLookup: Record<string, Set<StructProxy>> = {}
    protected middleware: StructSyncClient.Middleware[] = []

    constructor() {
        super()

        this.messageBridge.onRequest.add(this, event => {
            if (event.type == "StructSync:proxy_message") event.handle(async (msg: StructSyncMessages.AnyProxyMessage) => {
                for (const middleware of this.middleware) {
                    const ret = await middleware.options.onIncoming?.(this, msg)
                    if (ret != null) {
                        return ret
                    }
                }

                if (msg.type == "mut_assign" || msg.type == "mut_delete" || msg.type == "mut_splice") {
                    const proxies = this.trackedLookup[msg.target]
                    if (proxies) proxies.forEach(proxy => {
                        proxy.onMutate.emit(msg)
                        MutationUtil.applyMutation(proxy, msg)
                    })
                } else if (msg.type == "event") {
                    const proxies = this.trackedLookup[msg.target]
                    if (proxies) proxies.forEach(proxy => {
                        proxy.emitEvent(msg.event, msg.payload)
                    })
                } else if (msg.type == "meta") {
                    throw new Error(`Meta message of type ${JSON.stringify(msg.name)} not accepted`)
                } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
            })
        })
    }
}

export namespace StructSyncClient {
    export class Middleware extends EventListener {
        constructor(
            public readonly options: MiddlewareOptions
        ) {
            super()
        }
    }

    export interface MiddlewareOptions {
        onIncoming?: (client: StructSyncClient, msg: StructSyncMessages.AnyProxyMessage) => Promise<any>
        onOutgoing?: (client: StructSyncClient, msg: StructSyncMessages.AnyControllerMessage) => Promise<StructSyncMessages.AnyControllerMessage | void>
    }
}