import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE, disposeObject, IDisposable } from "../eventLib/Disposable"
import { Type } from "../struct/Type"
import { ActionType } from "./ActionType"
import { StructSyncClientService } from "./StructSyncClientService"
import { StructSyncServerService } from "./StructSyncServerService"

const BADGE = Symbol("badge")

export interface StructSyncContract<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
    base: T
    actions: A
    defineProxy(): StructSyncContract.StructProxyClass<T, A>
    defineController(): StructSyncContract.StructControllerClass<T, A>
}

const SERVER = Symbol("server")

function makeFullID(id: string | null, name: string) {
    if (id) return `${name}::${id}`
    else return name
}

const SERVICE = Symbol("service")

export namespace StructSyncContract {
    export const ACTION_IMPLS = Symbol("actionImpls")

    export function define<T extends { new(...args: any): any, baseType: Type<any> }, A extends Record<string, ActionType<any, any>>>(base: T, actions: A): StructSyncContract<T, A> {
        const name = base.baseType.name
        const actionsList = Object.entries(actions)

        return {
            base, actions,
            defineProxy() {
                const Proxy = class extends (base as unknown as { new(...args: any[]): any }) {
                    public [SERVICE] = DIContext.current.inject(StructSyncClientService)

                    public [DISPOSE]() { disposeObject(this) }

                    constructor(...args: any[]) {
                        super(...args)

                        for (const [key, action] of actionsList) {
                            this[key] = async (arg: any) => {
                                const serializedArgument = (action.args as Type<any>).serialize(arg)
                                const result = this[SERVICE].runAction(makeFullID(this.id, name), key, serializedArgument)
                                return (action.result as Type<any>).deserialize(result)
                            }
                        }
                    }

                    public static make(context: DIContext, id: string | null, track: boolean) {
                        return context.inject(StructSyncClientService).find(context, makeFullID(id, name), Proxy, track)
                    }
                }

                return Proxy as any
            },
            defineController() {
                return class extends (base as unknown as { new(...args: any[]): any }) {
                    public [SERVER]: StructSyncServerService | null = null

                    public [DISPOSE]() {
                        this[SERVER]?.unregister(makeFullID(this.id, name))
                        disposeObject(this)
                    }

                    public runAction(name: string, argument: any): Promise<any> {
                        const impl = this[ACTION_IMPLS][name]
                        if (impl) return impl((actions[name].args as Type<any>).deserialize(argument)).then(v => (actions[name].result as Type<any>).serialize(v))
                        else return Promise.reject(new Error(`Action "${name}" not implemented`))
                    }

                    public impl(impls: Record<string, (argument: any) => Promise<any>>) {
                        this[ACTION_IMPLS] = impls
                    }

                    public mutate() {
                        // eslint-disable-next-line no-console
                        console.warn("Mutating not yet implemented")
                    }

                    public register() {
                        this[SERVER] = DIContext.current.inject(StructSyncServerService)
                        this[SERVER]!.register(makeFullID(this.id, name), this)

                        return this
                    }

                    protected [ACTION_IMPLS]: Record<string, (argument: any) => Promise<any>> = {}

                    constructor(...args: any[]) {
                        super(...args)
                    }
                } as any
            }
        }
    }

    export type StructProxyInstance<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = InstanceType<T> & StructSyncContract.ActionFunctions<A> & IDisposable

    export interface StructProxyClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
        new(client: StructSyncClientService, data: any): StructProxyInstance<T, A>
        make(context: DIContext, id?: string): Promise<StructProxyInstance<T, A>>
    }

    export type StructControllerInstance<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = InstanceType<T> & {
        impl(impl: StructSyncContract.ActionFunctions<A>): StructControllerInstance<T, A>["impl"]
        runAction<K extends keyof A>(name: K, argument: Parameters<ActionFunctions<A>[K]>[0]): ReturnType<ActionFunctions<A>[K]>
        mutate<T>(this: T, thunk: (v: T) => void): Promise<void>
        register<T>(this: T): T
    } & IDisposable

    export type StructControllerClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = Pick<T, keyof T> & {
        new(...args: ConstructorParameters<T>): StructControllerInstance<T, A>
    }

    export type ActionFunctions<T extends Record<string, ActionType<any, any>>> = {
        [P in keyof T]: (arg: ActionType.ArgumentType<T[P]>) => Promise<ActionType.ResultType<T[P]>>
    }
}