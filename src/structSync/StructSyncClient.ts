import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DIService } from "../dependencyInjection/DIService"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { StructProxy } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"

export class StructSyncClient extends DIService.define() {
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
        return this.sendMessage({
            type: "action",
            action, argument, target
        })
    }

    public sendMessage(message: StructSyncMessages.AnyControllerMessage) {
        return this.messageBridge.sendRequest("StructSync:controller_message", message)
    }

    protected messageBridge = this.context.inject(MessageBridge)
    protected tracked = new Set<StructProxy>()
    protected trackedLookup: Record<string, Set<StructProxy>> = {}

    constructor() {
        super()

        this.messageBridge.onRequest.add(this, event => {
            if (event.type == "StructSync:proxy_message") event.handle(async (msg: StructSyncMessages.AnyProxyMessage) => {
                if (msg.type == "mut_assign" || msg.type == "mut_delete" || msg.type == "mut_splice") {
                    const proxies = this.trackedLookup[msg.target]
                    if (proxies) proxies.forEach(proxy => {
                        proxy.onMutate.emit(msg)
                        let receiver: any = proxy
                        let type = Struct.getBaseType(proxy) as Type.ObjectType | Type.ArrayType
                        msg.path.forEach(prop => {
                            receiver = receiver[prop]
                            type = (Type.isObject(type) ? type.props[prop] : type.type) as typeof type
                        })

                        if (msg.type == "mut_assign") {
                            const valueType = Type.isObject(type) ? type.props[msg.key] : type.type
                            receiver[msg.key] = valueType.deserialize(msg.value)
                        } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                    })
                } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
            })
        })
    }
}