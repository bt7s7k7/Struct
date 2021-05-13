import { Type } from "../struct/Type"

export interface ActionType<A extends Type<any>, R extends Type<any>> {
    name: string
    args: A
    result: R
}

export namespace ActionType {
    export function define<A extends Type<any>, R extends Type<any>>(name: string, args: A, result: R): ActionType<A, R> {
        return { name, args, result }
    }

    export type ArgumentType<T extends ActionType<any, any>> = T extends ActionType<Type<infer U>, any> ? U : never
    export type ResultType<T extends ActionType<any, any>> = T extends ActionType<any, Type<infer U>> ? U : never

    export type Functions<T extends Record<string, ActionType<any, any>>> = {
        [P in keyof T]: (arg: ActionType.ArgumentType<T[P]>) => Promise<ActionType.ResultType<T[P]>>
    }
}