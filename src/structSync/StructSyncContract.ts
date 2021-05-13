import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE, disposeObject, IDisposable } from "../eventLib/Disposable"
import { Type } from "../struct/Type"
import { ActionType } from "./ActionType"
import { StructSyncClient } from "./StructSyncClient"
import { StructSyncServer } from "./StructSyncServer"

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
                    public [SERVICE] = DIContext.current.inject(StructSyncClient)

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
                        return context.inject(StructSyncClient).find(context, makeFullID(id, name), Proxy, track)
                    }
                }

                return Proxy as any
            },
            defineController() {
                return class extends (base as unknown as { new(...args: any[]): any }) {
                    public [SERVER]: StructSyncServer | null = null

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
                        this[SERVER] = DIContext.current.inject(StructSyncServer)
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


    export interface StructProxyClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
        new(client: StructSyncClient, data: any): StructProxy<T, A>
        make(context: DIContext, id?: string): Promise<StructProxy<T, A>>
    }

    export type StructControllerClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = Pick<T, keyof T> & {
        new(...args: ConstructorParameters<T>): StructController<T, A>
    }
}

export type StructProxy<T extends { new(...args: any): any } = any, A extends Record<string, ActionType<any, any>> = any> = InstanceType<T> & ActionType.Functions<A> & IDisposable

export type StructController<T extends { new(...args: any): any } = any, A extends Record<string, ActionType<any, any>> = any> = InstanceType<T> & {
    impl(impl: ActionType.Functions<A>): StructController<T, A>["impl"]
    runAction<K extends keyof A>(name: K, argument: Parameters<ActionType.Functions<A>[K]>[0]): ReturnType<ActionType.Functions<A>[K]>
    mutate<T>(this: T, thunk: (v: T) => void): Promise<void>
    register<T>(this: T): T
} & IDisposable