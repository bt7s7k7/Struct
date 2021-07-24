import { Type } from "../struct/Type"
import { StructSyncMessages } from "./StructSyncMessages"

export class MetaMessageType<K extends string, T, R> {
    public matches(msg: any): msg is StructSyncMessages.MetaMessage<K> {
        return msg.type == "meta" && msg.name == this.name
    }

    public async process(msg: StructSyncMessages.MetaMessage<K>, callback: (argument: T) => Promise<R> | R) {
        return await this.result.serialize(await callback(this.argument.deserialize(msg.data)))
    }

    constructor(
        public readonly name: K,
        public readonly argument: Type<T>,
        public readonly result: Type<R>
    ) { }
}