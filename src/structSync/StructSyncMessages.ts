import { Mutation } from "../struct/Mutation"
import { StructSyncClient } from "./StructSyncClient"
import { StructSyncSession } from "./StructSyncSession"

export namespace StructSyncMessages {
    declare const _metaHandle: unique symbol
    export type MetaHandle = {
        [_metaHandle]: true
        session: StructSyncSession
        server: StructSyncClient
    }

    interface MessageBase {
        [index: `_${string}`]: any
    }

    export interface MetaMessage<K extends string = string> extends MessageBase {
        type: "meta"
        name: K
        data: any
    }

    interface ControllerMessageBase extends MessageBase {
        target: string
    }

    interface MutateMessageBase extends ControllerMessageBase {
        path: string[]
    }

    export interface ActionCallMessage extends ControllerMessageBase {
        type: "action"
        action: string
        argument: any
    }

    export interface FindControllerMessage extends ControllerMessageBase {
        type: "find"
        track: boolean
    }

    export interface AssignMutateMessage extends MutateMessageBase, Omit<Mutation.AssignMutation, "serialize" | "setLocal" | "isLocal"> { }

    export interface SpliceMutateMessage extends MutateMessageBase, Omit<Mutation.SpliceMutation, "serialize" | "setLocal" | "isLocal"> { }

    export interface DeleteMutateMessage extends MutateMessageBase, Omit<Mutation.DeleteMutation, "serialize" | "setLocal" | "isLocal"> { }

    export interface EventMessage extends ControllerMessageBase {
        type: "event"
        event: string
        payload: any

    }

    export type AnyMutateMessage = AssignMutateMessage | SpliceMutateMessage | DeleteMutateMessage
    export type AnyProxyMessage = AnyMutateMessage | EventMessage | MetaMessage
    export type AnyControllerMessage = ActionCallMessage | FindControllerMessage | MetaMessage
}
