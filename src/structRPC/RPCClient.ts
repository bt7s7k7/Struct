import { DIService } from "../dependencyInjection/DIService"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { Mutation } from "../struct/Mutation"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { RPCContract } from "./RPCContract"
import { RPCClientMessage_t, RPCEventDispatch, RPCServerRequest, RPCServerRequest_t, RPCServerResponse_t } from "./RPCMessage"
import { RPCProxy } from "./RPCProxy"

export class RPCClient extends DIService {
    protected readonly _bridge = this.context.inject(MessageBridge)
    protected readonly _tracked = new Map<string, Set<RPCProxy>>()

    protected async _sendRequest<T extends RPCServerRequest>(request: T) {
        const data = await this._bridge.sendRequest("rpc.request", RPCServerRequest_t.serialize(request))
        return RPCServerResponse_t[request.type].deserialize(data) as Type.Extract<typeof RPCServerResponse_t[T["type"]]>
    }

    protected async _find<T extends RPCProxy.ProxyClass>(type: T, target: InstanceType<T> | null, key: any, track: boolean) {
        if (key != null && typeof key != "string") key = String(key)

        const name = Struct.getBaseType(type).name
        const id = name + "\x00" + key
        const proxyData = await this._sendRequest({ type: "find", name, key, track })

        if (target == null) {
            target = new type(this)
        }

        Object.assign(target!, Struct.getBaseType(type).deserialize(proxyData))

        if (track) {
            let collection = this._tracked.get(id)
            if (collection == null) {
                collection = new Set()
                this._tracked.set(id, collection)
            }
            collection.add(target!)
        }

        return target!
    }

    public async getRaw<T extends RPCProxy.ProxyClass>(type: T, key: RPCContract.Key<T["contract"]>) {
        return new type(this)
    }

    public async getData<T extends RPCProxy.ProxyClass>(type: T, key: RPCContract.Key<T["contract"]>) {
        return this._find(type, null, key, false)
    }

    public async getReactive<T extends RPCProxy.ProxyClass>(type: T, key: RPCContract.Key<T["contract"]>) {
        return this._find(type, null, key, true)
    }

    public async bind(proxy: RPCProxy) {
        await this._find(proxy.constructor as RPCProxy.ProxyClass, proxy, proxy[RPCProxy.PRIMARY_KEY], true)
    }

    public async sync(proxy: RPCProxy) {
        await this._find(proxy.constructor as RPCProxy.ProxyClass, proxy, proxy[RPCProxy.PRIMARY_KEY], false)
    }

    public async unbind(proxy: RPCProxy) {
        const rawKey = proxy[RPCProxy.PRIMARY_KEY]
        const key = rawKey != null && typeof rawKey != "string" ? String(rawKey) : rawKey

        const name = Struct.getBaseType(proxy).name
        const id = name + "\x00" + key
        const collection = this._tracked.get(id)
        if (collection == null || !collection.delete(proxy)) {
            return false
        }

        if (collection.size == 0) {
            this._tracked.delete(id)
        }

        await this._sendRequest({ type: "unbind", name, key: key as string | undefined })
        return true
    }

    public async call(proxy: RPCProxy, actionName: string, argument: any) {
        const contract = proxy[RPCProxy.CONTRACT]
        const action = contract.actions.get(actionName)

        const name = contract.type.name
        const rawKey = proxy[RPCProxy.PRIMARY_KEY]
        const key = rawKey != null && typeof rawKey != "string" ? String(rawKey) : rawKey

        if (action == null) throw new Error(`No action named ${JSON.stringify(actionName)} on "${name}"`)
        const result = await this._sendRequest({ type: "action", action: actionName, name, key: key as string | undefined, argument: action.argument.serialize(argument) })
        return action.result.deserialize(result)
    }

    constructor() {
        super()

        this._bridge.onRequest.add(this, request => {
            if (request.type == "rpc.notify") request.handle(async (data) => {
                const message = RPCClientMessage_t.deserialize(data)
                const targets = this._tracked.get(message.id)
                if (targets == null) throw new Error(`Received message for invalid target ${JSON.stringify(message.id)}`)

                for (const action of message.actions) {
                    if (action instanceof Mutation.AssignMutation || action instanceof Mutation.DeleteMutation || action instanceof Mutation.SpliceMutation) {
                        for (const target of targets) {
                            Mutation.apply(target, Struct.getType(target), action)
                        }
                    } else if (action instanceof RPCEventDispatch) {
                        let first = false
                        let value: any = null
                        for (const target of targets) {
                            if (first) {
                                const event = target[RPCProxy.CONTRACT].events.get(action.event)
                                if (event == null) throw new Error(`Received invalid event ${JSON.stringify(action.event)} for target ${JSON.stringify(message.id)}`)
                                value = event.deserialize(action.value)
                                first = false
                            }

                            target[action.event].emit(value)
                        }
                    }
                }
            })
        })
    }
}
