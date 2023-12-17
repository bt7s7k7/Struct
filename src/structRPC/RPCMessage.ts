import { Mutation } from "../struct/Mutation"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"

export class RPCEventDispatch extends Struct.define("RPCEventDispatch", {
    type: Type.enum("event"),
    event: Type.string,
    value: Type.passthrough<any>(null)
}) { }

export type RPCClientMessage = Mutation.AnyMutation | RPCEventDispatch
export const RPCClientMessage_t = Type.object({
    id: Type.string,
    actions: Type.byKeyUnion<RPCClientMessage, "type">("RPCClientMessage", "type", {
        mut_assign: Mutation.AssignMutation.ref(),
        mut_delete: Mutation.DeleteMutation.ref(),
        mut_splice: Mutation.SpliceMutation.ref(),
        event: RPCEventDispatch.ref()
    }, () => null).as(Type.array)
})


const _RPCServerContract = {
    find: Type.action(Type.object({ type: Type.enum("find"), name: Type.string, key: Type.string.as(Type.nullable), track: Type.boolean }), Type.passthrough<any>(null)),
    action: Type.action(Type.object({ type: Type.enum("action"), name: Type.string, key: Type.string.as(Type.nullable), action: Type.string, argument: Type.passthrough<any>(null) }), Type.passthrough<any>(null)),
    unbind: Type.action(Type.object({ type: Type.enum("unbind"), name: Type.string, key: Type.string.as(Type.nullable) }), Type.empty)
}

const _selectProps = <U extends keyof any, T, K extends keyof T>(object: Record<U, T>, key: K) => {
    return Object.fromEntries(Object.entries(object).map(v => [v[0], (v[1] as T)[key]] as const))
}
type _SelectProps<T, K extends keyof T[keyof T]> = { [P in keyof T]: T[P][K] }

const _serverRequest = _selectProps(_RPCServerContract, "argument") as _SelectProps<typeof _RPCServerContract, "argument">
type _GetValues<T> = T[keyof T]
type _ExtractProps<T extends Record<string, Type<any>>> = _GetValues<{ [P in keyof T]: Type.Extract<T[P]> }>
export const RPCServerRequest_t = Type.byKeyUnion<_ExtractProps<typeof _serverRequest>, "type">("RPCServerRequest", "type", _serverRequest, () => null)
export type RPCServerRequest = Type.Extract<typeof RPCServerRequest_t>
export const RPCServerResponse_t = _selectProps(_RPCServerContract, "result") as _SelectProps<typeof _RPCServerContract, "result">
