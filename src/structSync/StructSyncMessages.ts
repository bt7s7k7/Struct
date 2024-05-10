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

    export interface ActionCallMessage extends ControllerMessageBase {
        type: "action"
        action: string
        argument: any
    }

    export interface FindControllerMessage extends ControllerMessageBase {
        type: "find"
        track: boolean
    }

    export interface MutateMessage extends ControllerMessageBase {
        type: "mutate"
    }

    export interface EventMessage extends ControllerMessageBase {
        type: "event"
        event: string
        payload: any

    }

    export type AnyProxyMessage = MutateMessage | EventMessage | MetaMessage
    export type AnyControllerMessage = ActionCallMessage | FindControllerMessage | MetaMessage
}
