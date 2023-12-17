import { DISPOSE, disposeObject } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { Type } from "../struct/Type"
import { RPCClient } from "./RPCClient"
import { RPCContract } from "./RPCContract"

type _ProxyActions<T extends Record<string, Type.Action<Type<any>, Type<any>>>> = { [P in keyof T]: (argument: Type.ActionArgument<T[P]>) => Promise<Type.ActionResult<T[P]>> }
type _ProxyEvents<T extends Record<string, Type<any>>> = { [P in keyof T]: EventEmitter<Type.Extract<T[P]>> }
type _ContractConstraints = RPCContract<any, any, any, any>

export interface RPCProxy<T extends RPCContract = RPCContract> {
    [DISPOSE](): void
    [RPCProxy.CLIENT]: RPCClient
    [RPCProxy.CONTRACT]: T
    [RPCProxy.PRIMARY_KEY]: RPCContract.Key<T>
}

export function RPCProxy<T extends _ContractConstraints>(contract: T) {
    const result = class extends contract.ctor {
        public get [RPCProxy.PRIMARY_KEY]() { return contract.primaryKey == null ? null : this[contract.primaryKey] }
        public [RPCProxy.CLIENT]: RPCClient
        public [RPCProxy.CONTRACT] = contract

        public [DISPOSE]() {
            if (super[DISPOSE]) {
                super[DISPOSE]()
            } else {
                disposeObject(this)
            }

            this[RPCProxy.CLIENT].unbind(this)
        }

        constructor(client: RPCClient) {
            super({ ...contract.type.default() })
            this[RPCProxy.CLIENT] = client

            for (const eventName of contract.events.keys()) {
                (this as any)[eventName] = new EventEmitter()
            }

            if ((this.constructor as typeof result).instanceDecorator != null) {
                return (this.constructor as typeof result).instanceDecorator!(this as any)
            }
        }

        public static readonly contract = contract
        public static instanceDecorator: ((value: any) => any) | null = null
    } as RPCProxy.ProxyClass<T>

    for (const actionName of contract.actions.keys()) {
        result.prototype[actionName] = function (this: RPCProxy, argument: any) {
            return this[RPCProxy.CLIENT].call(this, actionName as string, argument)
        }
    }

    return result
}

export namespace RPCProxy {
    export const CLIENT = Symbol.for("rpc.client")
    export const PRIMARY_KEY = Symbol.for("rpc.primaryKey")
    export const CONTRACT = Symbol.for("rpc.contract")

    export interface ProxyClass<T extends _ContractConstraints = _ContractConstraints> {
        /** @deprecated Do not use the constructor directly, use RPCClient.bind */
        new(client: RPCClient):
            & RPCProxy<T>
            & InstanceType<RPCContract.Class<T>>
            & _ProxyActions<RPCContract.Actions<T>>
            & _ProxyEvents<RPCContract.Events<T>>
        contract: T
        instanceDecorator: ((value: any) => any) | null
    }
}
