export namespace StructSyncMessages {
    declare const _metaHandle: unique symbol
    export type MetaHandle = { [_metaHandle]: true }

    interface MessageBase {
        type: string
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

    export interface AssignMutateMessage extends MutateMessageBase {
        type: "mut_assign"
        value: any
        key: string
    }

    export interface SpliceMutateMessage extends MutateMessageBase {
        type: "mut_splice"
        index: number
        deleteCount: number
        items: any[]
    }

    export interface DeleteMutateMessage extends MutateMessageBase {
        type: "mut_delete"
        key: string
    }

    export interface EventMessage extends ControllerMessageBase {
        type: "event"
        event: string
        payload: any

    }

    export type AnyMutateMessage = AssignMutateMessage | SpliceMutateMessage | DeleteMutateMessage
    export type AnyProxyMessage = AnyMutateMessage | EventMessage | MetaMessage
    export type AnyControllerMessage = ActionCallMessage | FindControllerMessage | MetaMessage
}