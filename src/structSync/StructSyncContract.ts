import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE, disposeObject, IDisposable } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "./ActionType"
import { EventType } from "./EventType"
import { MutationUtil } from "./MutationUtil"
import { StructSyncClient } from "./StructSyncClient"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

const BADGE = Symbol("badge")

export interface StructSyncContract<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>, E extends Record<string, EventType<any>>> {
    base: T
    actions: A
    events: E
    defineProxy(): StructSyncContract.StructProxyClass<T, A, E>
    defineController(): StructSyncContract.StructControllerClass<T, A, E>
}

const SERVER = Symbol("server")

function makeFullID(id: string | null | undefined, name: string) {
    if (id) return `${name}::${id}`
    else return name
}

const SERVICE = Symbol("service")

export namespace StructSyncContract {
    export const ACTION_IMPLS = Symbol("actionImpls")

    export function define<
        T extends { new(...args: any): any, baseType: Type<any> },
        A extends Record<string, ActionType<any, any>>,
        >(base: T, actions: A): StructSyncContract<T, A, {}>
    export function define<
        T extends { new(...args: any): any, baseType: Type<any> },
        A extends Record<string, ActionType<any, any>>,
        E extends Record<string, EventType<any>>
    >(base: T, actions: A, events: E): StructSyncContract<T, A, E>
    export function define<
        T extends { new(...args: any): any, baseType: Type<any> },
        A extends Record<string, ActionType<any, any>>,
        E extends Record<string, EventType<any>>
    >(base: T, actions: A, _events: E | null = null): StructSyncContract<T, A, E> {
        const events = _events ?? ({} as E)
        const name = base.baseType.name
        const actionsList = Object.entries(actions)

        return {
            base, actions, events,
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
                            (this[key] as any) = async (arg: any) => {
                                const serializedArgument = (action.args as Type<any>).serialize(arg)
                                const result = await this[SERVICE].runAction(makeFullID((this as any).id, name), key, serializedArgument)
                                return (action.result as Type<any>).deserialize(result)
                            }
                        }

                        for (const [key, eventType] of Object.entries(events)) {
                            const emitter = new EventEmitter<any>()
                            void ((this as any)[key] = emitter)
                        }
                    }

                    public static make(context: DIContext, { id, track = true }: StructProxyFactoryOptions = {}) {
                        return context.inject(StructSyncClient).find(context, makeFullID(id, name), this, track)
                    }

                    public static default() {
                        return new Proxy(base.baseType.default())
                    }
                }

                return Proxy as any
            },
            defineController() {
                return class extends (base as unknown as { new(...args: any[]): StructController<{ new(): Struct.StructBase } & Type<any>, {}, {}> }) {
                    public [SERVER]: StructSyncServer | null = null

                    public [DISPOSE]() {
                        this[SERVER]?.unregister(makeFullID((this as any).id, name))
                        disposeObject(this)
                    }

                    public runAction(name: string, argument: any): any {
                        const impl = this[ACTION_IMPLS][name]
                        if (impl) return impl((actions[name].args as Type<any>).deserialize(argument)).then(v => (actions[name].result as Type<any>).serialize(v))
                        else return Promise.reject(new Error(`Action "${name}" not implemented`))
                    }

                    public impl(impls: Record<string, (argument: any) => Promise<any>>) {
                        this[ACTION_IMPLS] = impls
                        return this.impl
                    }

                    public async mutate(thunk: (proxy: any) => void) {
                        const fullName = makeFullID((this as any).id, name)

                        const mutations = MutationUtil.runMutationThunk(fullName, this, base.baseType, thunk)

                        if (this[SERVER]) for (const mutation of mutations) {
                            await this[SERVER]!.notifyMutation(mutation)
                        }
                    }

                    public register() {
                        this[SERVER] = DIContext.current.inject(StructSyncServer)
                        this[SERVER]!.register(makeFullID((this as any).id, name), this as any)

                        return this as any
                    }

                    protected [ACTION_IMPLS]: Record<string, (argument: any) => Promise<any>> = {}

                    constructor(...args: any[]) {
                        super(...args)
                        for (const [key, eventType] of Object.entries(events)) {
                            const emitter = new EventEmitter<any>()
                            void ((this as any)[key] = emitter)

                            emitter.add(null, (value) => {
                                const serialized = (eventType.result as Type<any>).serialize(value)
                                // TODO: Send event
                            })
                        }
                    }
                } as any
            }
        }
    }

    export interface StructProxyFactoryOptions {
        id?: string
        track?: boolean
    }

    export interface StructProxyClass<
        T extends { new(...args: any): any },
        A extends Record<string, ActionType<any, any>>,
        E extends Record<string, EventType<any>>
        > {
        new(client: StructSyncClient, data: any): StructProxy<T, A, E>
        make(context: DIContext, options?: StructProxyFactoryOptions): Promise<StructProxy<T, A, E>>
        default(): StructProxy<T, A, E>
    }

    export type StructControllerClass<
        T extends { new(...args: any): any },
        A extends Record<string, ActionType<any, any>>,
        E extends Record<string, EventType<any>>
        > = Pick<T, keyof T> & {
            new(...args: ConstructorParameters<T>): StructController<T, A, E>
        }
}

export type StructProxy<
    T extends { new(...args: any): any } = { new(): Struct.StructBase } & Type<any>,
    A extends Record<string, ActionType<any, any>> = Record<string, ActionType<any, any>>,
    E extends Record<string, EventType<any>> = Record<string, EventType<any>>,
    > =
    InstanceType<T> &
    EventType.Emitters<E> &
    ActionType.Functions<A> &
    IDisposable &
    { onMutate: EventEmitter<StructSyncMessages.AnyMutateMessage> }

export type StructController<
    T extends { new(...args: any): any } = { new(): Struct.StructBase } & Type<any>,
    A extends Record<string, ActionType<any, any>> = Record<string, ActionType<any, any>>,
    E extends Record<string, EventType<any>> = Record<string, EventType<any>>
    > = InstanceType<T> &
    EventType.Emitters<E> &
    {
        impl(impl: ActionType.Functions<A>): StructController<T, A>["impl"]
        runAction<K extends keyof A>(name: K, argument: Parameters<ActionType.Functions<A>[K]>[0]): ReturnType<ActionType.Functions<A>[K]>
        mutate<T>(this: T, thunk: (v: T) => void): Promise<void>
        register<T>(this: T): T
    } & IDisposable