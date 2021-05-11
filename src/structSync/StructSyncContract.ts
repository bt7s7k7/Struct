import { IDisposable } from "../eventLib/Disposable"
import { ActionType } from "./ActionType"

const BADGE = Symbol("badge")

export interface StructSyncContract<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
    base: T
    actions: A
    defineProxy(): StructSyncContract.StructProxyClass<T, A>
    defineController(): StructSyncContract.StructControllerClass<T, A>
}

export namespace StructSyncContract {
    export function define<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>>(base: T, actions: A): StructSyncContract<T, A> {
        const actionsList = Object.entries(actions)

        return {
            base, actions,
            defineProxy() {
                return class extends (base as unknown as { new(...args: any[]): any }) {
                    constructor(...args: any[]) {
                        super(...args)
                        for (const [key, action] of actionsList) {
                            this[key] = async () => {
                                return null
                            }
                        }
                    }
                } as any
            },
            defineController() {
                return class extends (base as unknown as { new(...args: any[]): any }) {
                    public runAction(name: string, argument: any): Promise<any> {
                        const impl = this.actionImpls[name]
                        if (impl) return impl(argument)
                        else return Promise.reject(new Error(`Action "${name}" not implemented`))
                    }

                    public impl(impls: this["actionImpls"]) {
                        this.actionImpls = impls
                    }

                    protected actionImpls: Record<string, (argument: any) => Promise<any>> = {}

                    constructor(...args: any[]) {
                        super(...args)
                    }
                } as any
            }
        }
    }

    export type StructProxyInstance<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = InstanceType<T> & StructSyncContract.ActionFunctions<A> & IDisposable

    export interface StructProxyClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> {
        new(badge: typeof BADGE, ...args: ConstructorParameters<T>): StructProxyInstance<T, A>
        make(id?: string): Promise<StructProxyInstance<T, A>>
    }

    export type StructControllerInstance<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = InstanceType<T> & {
        impl(impl: StructSyncContract.ActionFunctions<A>): StructControllerInstance<T, A>["impl"]
        runAction<K extends keyof A>(name: K, argument: Parameters<ActionFunctions<A>[K]>[0]): ReturnType<ActionFunctions<A>[K]>
    } & IDisposable

    export type StructControllerClass<T extends { new(...args: any): any }, A extends Record<string, ActionType<any, any>>> = Pick<T, keyof T> & {
        new(...args: ConstructorParameters<T>): StructControllerInstance<T, A>
    }

    export type ActionFunctions<T extends Record<string, ActionType<any, any>>> = {
        [P in keyof T]: (arg: ActionType.ArgumentType<T[P]>) => Promise<ActionType.ResultType<T[P]>>
    }
}