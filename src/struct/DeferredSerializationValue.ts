import { DeserializationError, Deserializer, Serializer, Type } from "./Type"

class _DeferredSerializationValueType extends Type<DeferredSerializationValue> {

    public verify(value: unknown): DeferredSerializationValue {
        if (!(value instanceof DeferredSerializationValue)) throw new DeserializationError("Expected " + this.name)
        return value
    }

    protected _serialize(source: DeferredSerializationValue, serializer: Serializer): unknown {
        if (source.type != null) {
            return source.type["_serialize"](source.value, serializer)
        } else {
            return serializer.createAny(source.value)
        }
    }

    protected _deserialize(handle: any, deserializer: Deserializer): DeferredSerializationValue {
        return DeferredSerializationValue.prepareDeserialization(handle, deserializer)
    }

    public readonly name = "DeferredSerializationValue"

    public getDefinition(indent: string): string {
        return indent + "DeferredSerializationValue"
    }

    public default() {
        return DeferredSerializationValue.null
    }
}

const _DEFERRED_VALUE_TYPE = new _DeferredSerializationValueType()

/**
 * Use this for creating serializable generic container types. For serialization, this class holds both the value and the type,
 * which can be dynamically set. For deserialization this class keeps the deserialization handle and a reference to the deserializer.
 * The actual value is then deserialized later based on a type which is only known later. To get the type use {@link DeferredSerializationValue.ref} like with structs.
 * */
export class DeferredSerializationValue {
    /**
     * If this instance is a result of deserialization, provide a type to deserialize its value.
     * If type is `null`, deserialization proceeds using {@link Deserializer.parseAny}. If this instance
     * is not a result of deserialization, its value is returned.
     * */
    public getValue<T>(type: Type<T>): T
    public getValue(type: null): any
    public getValue(type: Type | null) {
        if (this.deserializer) {
            if (type != null) {
                return type["_deserialize"](this.value, this.deserializer)
            } else {
                return this.deserializer.parseAny(this.value)
            }
        } else {
            return this.value
        }
    }

    protected constructor(
        public readonly value: any,
        public readonly type: Type | null,
        public readonly deserializer: Deserializer | null,
    ) { }

    /** Use this to prepare for serialization of values with known types */
    public static prepareSerialization<T>(value: T, type: Type<T>): DeferredSerializationValue
    public static prepareSerialization(value: any, type: Type) {
        return new DeferredSerializationValue(value, type, null)
    }

    /** Use this to prepare for serialization of values with unknown types */
    public static prepareSerializationUntyped(value: any) {
        return new DeferredSerializationValue(value, null, null)
    }

    /** Use this to prepare for deserialization */
    public static prepareDeserialization(handle: any, deserializer: Deserializer) {
        return new DeferredSerializationValue(handle, null, deserializer)
    }

    public static readonly null = this.prepareSerialization(null, Type.empty)

    public static ref() {
        return _DEFERRED_VALUE_TYPE as Type<DeferredSerializationValue>
    }
}

