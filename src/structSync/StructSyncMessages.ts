export namespace StructSyncMessages {
    interface MessageBase {
        type: string
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

    export type AnyProxyMessage = AssignMutateMessage | SpliceMutateMessage | DeleteMutateMessage
    export type AnyControllerMessage = ActionCallMessage | FindControllerMessage
}