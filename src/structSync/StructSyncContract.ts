import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE, disposeObject, IDisposable } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "./ActionType"
import { StructSyncClient } from "./StructSyncClient"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

const BADGE = Symbol("badge")

export interface StructSyncContract<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
    base: T
    actions: A
    defineProxy(): StructSyncContract.StructProxyClass<T, A>
    defineController(): StructSyncContract.StructControllerClass<T, A>
}

const SERVER = Symbol("server")

function makeFullID(id: string | null | undefined, name: string) {
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
                const Proxy = class extends (base as unknown as { new(...args: any[]): StructProxy }) {
                    public [SERVICE] = DIContext.current.inject(StructSyncClient)

                    public [DISPOSE]() {
                        disposeObject(this)
                        this[SERVICE].unregister(makeFullID((this as any).id, name), this)
                    }

                    constructor(...args: any[]) {
                        super(...args)

                        this.onMutate = new EventEmitter<StructSyncMessages.AnyMutateMessage>()

                        for (const [key, action] of actionsList) {
                            this[key] = async (arg: any) => {
                                const serializedArgument = (action.args as Type<any>).serialize(arg)
                                const result = this[SERVICE].runAction(makeFullID((this as any).id, name), key, serializedArgument)
                                return (action.result as Type<any>).deserialize(result)
                            }
                        }
                    }

                    public static make(context: DIContext, { id, track = true }: StructProxyFactoryOptions = {}) {
                        return context.inject(StructSyncClient).find(context, makeFullID(id, name), Proxy, track)
                    }
                }

                return Proxy as any
            },
            defineController() {
                return class extends (base as unknown as { new(...args: any[]): StructController }) {
                    public [SERVER]: StructSyncServer | null = null

                    public [DISPOSE]() {
                        this[SERVER]?.unregister(makeFullID((this as any).id, name))
                        disposeObject(this)
                    }

                    public runAction(name: string, argument: any): Promise<any> {
                        const impl = this[ACTION_IMPLS][name]
                        if (impl) return impl((actions[name].args as Type<any>).deserialize(argument)).then(v => (actions[name].result as Type<any>).serialize(v))
                        else return Promise.reject(new Error(`Action "${name}" not implemented`))
                    }

                    public impl(impls: Record<string, (argument: any) => Promise<any>>) {
                        this[ACTION_IMPLS] = impls
                        return this.impl
                    }

                    public async mutate(thunk: (proxy: any) => void) {
                        const mutations: StructSyncMessages.AnyMutateMessage[] = []
                        const targetController = makeFullID((this as any).id, name)

                        const makeProxy = (object: any, type: Type<any>, path: string[]): any => {
                            if (!Type.isArray(type) && !Type.isObject(type)) throw new Error("Cannot mutate a type that is not an object or array")

                            return new Proxy(object, {
                                set(target, key, value, receiver) {
                                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                                    if (!Reflect.set(target, key, value, receiver)) return false

                                    const serializedValue = Type.isArray(type) ? type.type.serialize(value) : type.props[key].serialize(value)

                                    mutations.push({
                                        type: "mut_assign",
                                        target: targetController,
                                        value: serializedValue,
                                        path, key
                                    })

                                    return true
                                },
                                deleteProperty(target, key) {
                                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                                    if (!Reflect.deleteProperty(target, key)) return false

                                    mutations.push({
                                        type: "mut_delete",
                                        target: targetController,
                                        path, key
                                    })

                                    return true
                                },
                                get(target, key, receiver) {
                                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                                    if (Type.isArray(type)) {
                                        const func = ({
                                            splice(start: number, deleteCount: number, ...items: any[]) {
                                                mutations.push({
                                                    type: "mut_splice",
                                                    deleteCount, path,
                                                    target: targetController,
                                                    index: start,
                                                    items: type.serialize(items)
                                                })
                                            }
                                        } as Partial<any[]>)[key as any]

                                        if (func) return func

                                        if (key in []) throw new Error(`Unsupported array operation ${JSON.stringify(key)}`)
                                    }

                                    return makeProxy(Reflect.get(target, key, receiver), Type.isObject(type) ? type.props[key] : type.type, [...path, key])
                                }
                            })
                        }

                        thunk(makeProxy(this, base.baseType, []))

                        if (this[SERVER]) mutations.forEach(v => this[SERVER]!.notifyMutation(v))
                    }

                    public register() {
                        this[SERVER] = DIContext.current.inject(StructSyncServer)
                        this[SERVER]!.register(makeFullID((this as any).id, name), this)

                        return this as any
                    }

                    protected [ACTION_IMPLS]: Record<string, (argument: any) => Promise<any>> = {}

                    constructor(...args: any[]) {
                        super(...args)
                    }
                } as any
            }
        }
    }

    export interface StructProxyFactoryOptions {
        id?: string
        track?: boolean
    }

    export interface StructProxyClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
        new(client: StructSyncClient, data: any): StructProxy<T, A>
        make(context: DIContext, options?: StructProxyFactoryOptions): Promise<StructProxy<T, A>>
    }

    export type StructControllerClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = Pick<T, keyof T> & {
        new(...args: ConstructorParameters<T>): StructController<T, A>
    }
}

export type StructProxy<T extends { new(...args: any): any } = { new(): Struct.StructBase } & Type<any>, A extends Record<string, ActionType<any, any>> = Record<string, ActionType<any, any>>> =
    InstanceType<T> &
    ActionType.Functions<A> &
    IDisposable &
    { onMutate: EventEmitter<StructSyncMessages.AnyMutateMessage> }

export type StructController<T extends { new(...args: any): any } = { new(): Struct.StructBase } & Type<any>, A extends Record<string, ActionType<any, any>> = Record<string, ActionType<any, any>>> = InstanceType<T> & {
    impl(impl: ActionType.Functions<A>): StructController<T, A>["impl"]
    runAction<K extends keyof A>(name: K, argument: Parameters<ActionType.Functions<A>[K]>[0]): ReturnType<ActionType.Functions<A>[K]>
    mutate<T>(this: T, thunk: (v: T) => void): Promise<void>
    register<T>(this: T): T
} & IDisposable