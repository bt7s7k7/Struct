import { DIContext } from "../dependencyInjection/DIContext"
import { DISPOSE, disposeObject, IDisposable } from "../eventLib/Disposable"
import { EventEmitter } from "../eventLib/EventEmitter"
import { IEventListener, implementEventListener } from "../eventLib/EventListener"
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
    defineProxy(): StructSyncContract.StructProxyClass<T, A, E> & Pick<T, Extract<keyof T, "baseType">>
    defineController(): StructSyncContract.StructControllerClass<T, A, E>
}

const SERVER = Symbol("server")

function makeFullID(id: string | null | undefined, name: string) {
    if (id) return `${name}::${id}`
    else return name
}

const SERVICE = Symbol("service")

export class ControllerActionNotFoundError extends Error {
    public _isClientError = true

    constructor(action: string) {
        super(`Action ${JSON.stringify(action)} not found on controller`)
    }
}

export namespace StructSyncContract {
    export const ACTION_IMPLS = Symbol("actionImpls")
    export const INSTANCE_DECORATOR = Symbol("instanceDecorator")

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
                const Proxy = class extends (base as unknown as { new(...args: any[]): StructProxy<{ new(): Struct.StructBase } & Type<any>, {}, {}> }) {
                    public [SERVICE] = DIContext.current.inject(StructSyncClient)

                    public [DISPOSE]() {
                        disposeObject(this)
                        this[SERVICE].unregister(makeFullID((this as any).id, name), (this as unknown as StructProxy))
                    }

                    public emitEvent(event: string, payload: any) {
                        if (event in events) {
                            const deserialized = (events[event].result as Type<any>).deserialize(payload)
                            void (this as any)[event].emit(deserialized)
                        } else throw new RangeError("Unknown event " + JSON.stringify(event))
                    }

                    public async synchronize() {
                        const data = await this[SERVICE].sendMessage({
                            type: "find",
                            target: makeFullID((this as any).id, name),
                            track: false
                        })

                        const instance = base.baseType.deserialize(data)
                        Object.assign(this, instance)
                    }

                    constructor(...args: any[]) {
                        super(...args)

                        const self = new.target[INSTANCE_DECORATOR] != null ? new.target[INSTANCE_DECORATOR]!(this) : this

                        self.onMutate = new EventEmitter<StructSyncMessages.AnyMutateMessage>()

                        for (const [key, action] of actionsList) {
                            ((self as any)[key] as any) = async (arg: any) => {
                                const serializedArgument = (action.args as Type<any>).serialize(arg)
                                const result = await self[SERVICE].runAction(makeFullID((self as any).id, name), key, serializedArgument)
                                return (action.result as Type<any>).deserialize(result)
                            }
                        }

                        for (const key of Object.keys(events)) {
                            const emitter = new EventEmitter<any>()
                            void ((self as any)[key] = emitter)
                        }

                        return self
                    }

                    public static make(context: DIContext, { id, track = true }: StructProxyFactoryOptions = {}) {
                        return context.inject(StructSyncClient).find(context, makeFullID(id, name), this, track)
                    }

                    public static default() {
                        const proxy = new this(base.baseType.default())
                        proxy[SERVICE].register(name, proxy as any)
                        return proxy
                    }

                    public static [INSTANCE_DECORATOR]: (<T>(instance: T) => T) | null = null
                }

                return Proxy as any
            },
            defineController() {
                return class Controller extends (base as unknown as { new(...args: any[]): StructController<{ new(): Struct.StructBase } & Type<any>, {}, {}> }) {
                    public [SERVER]: StructSyncServer | null = null

                    public getWeakRef = implementEventListener(this)

                    public [DISPOSE]() {
                        this[SERVER]?.unregister(makeFullID((this as any).id, name))
                        disposeObject(this)
                    }

                    public runAction(name: string, argument: any, meta: StructSyncMessages.MetaHandle): any {
                        const impl = this[ACTION_IMPLS][name]
                        if (impl) return impl((actions[name].args as Type<any>).deserialize(argument), meta).then(v => (actions[name].result as Type<any>).serialize(v))
                        else return Promise.reject(new ControllerActionNotFoundError(name))
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

                    protected [ACTION_IMPLS]: Record<string, (argument: any, meta: StructSyncMessages.MetaHandle) => Promise<any>> = {}

                    constructor(...args: any[]) {
                        super(...args)

                        const self = new.target[INSTANCE_DECORATOR] != null ? new.target[INSTANCE_DECORATOR]!(this) : this

                        for (const [key, eventType] of Object.entries(events)) {
                            const emitter = new EventEmitter<any>()
                            void ((self as any)[key] = emitter)

                            emitter.add(null, (value) => {
                                const serialized = (eventType.result as Type<any>).serialize(value)
                                self[SERVER]?.emitEvent({
                                    type: "event",
                                    target: makeFullID((self as any).id, name),
                                    event: key,
                                    payload: serialized
                                }).catch(err => {
                                    // eslint-disable-next-line no-console
                                    console.error(err)
                                })
                            })
                        }

                        return self
                    }

                    public static [INSTANCE_DECORATOR]: (<T>(instance: T) => T) | null = null
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
        make<T extends new (...args: any[]) => any>(this: T, context: DIContext, options?: StructProxyFactoryOptions): Promise<InstanceType<T>>
        default<T extends new (...args: any[]) => any>(this: T): InstanceType<T>
    }

    export type StructControllerClass<
        T extends { new(...args: any): any },
        A extends Record<string, ActionType<any, any>>,
        E extends Record<string, EventType<any>>
        > = Pick<T, keyof T> & {
            new(...args: ConstructorParameters<T>): StructController<T, A, E>
        }

    export function addDecorator<T>(ctor: { new(...args: any): T }, decorator: (instance: T) => any) {
        const target = ctor as unknown as { [INSTANCE_DECORATOR]: (<T>(instance: T) => T) | null }
        if (target[INSTANCE_DECORATOR]) {
            const oldDecorator = target[INSTANCE_DECORATOR]
            target[INSTANCE_DECORATOR] = ((v: any) => decorator(oldDecorator!(v))) as any
        } else target[INSTANCE_DECORATOR] = decorator as any
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
    {
        onMutate: EventEmitter<StructSyncMessages.AnyMutateMessage>
        emitEvent(event: string, payload: any): void
        synchronize(): Promise<void>
    }

export type StructController<
    T extends { new(...args: any): any } = { new(): Struct.StructBase } & Type<any>,
    A extends Record<string, ActionType<any, any>> = Record<string, ActionType<any, any>>,
    E extends Record<string, EventType<any>> = Record<string, EventType<any>>
    > = InstanceType<T> &
    EventType.Emitters<E> &
    {
        impl(impl: ActionType.FunctionsImpl<A>): StructController<T, A>["impl"]
        runAction<K extends keyof A>(name: K, argument: Parameters<ActionType.Functions<A>[K]>[0], meta: StructSyncMessages.MetaHandle): ReturnType<ActionType.Functions<A>[K]>
        mutate<T>(this: T, thunk: (v: T) => void): Promise<void>
        register<T>(this: T): T
    } & IEventListener