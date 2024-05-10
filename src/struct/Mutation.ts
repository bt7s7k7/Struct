import { Struct } from "./Struct"
import { DeserializationError, Deserializer, Serializer, Type } from "./Type"

const DRY_MUTATION = Symbol.for("struct.rawMutation")

const _MUTATION_PROPS = {
    path: Type.string.as(Type.array),
    type: Type.passthrough<Type>().as(Type.nullable),
    deserializer: Type.passthrough<Deserializer>().as(Type.nullable)
}

// Mutation serialization uses a custom type to support two workflows. In the typed workflow a type is
// provided to the mutation creation function, so the type of the changed value is available. In the untyped
// workflow, no types are known. Mutations must be (de)serializable in both cases. Also the (de)serializer
// type is not provided during mutation creation or application. The steps 2 and 3 are optional, a mutation
// should be able to be applied locally.
//
// # Typed workflow
// 
//     1. Create mutation (stores value and value type)
//         Mutation: value: any, type: any, path: string[]
//     2. Serialize mutation (serialize value using stored type)
//         Mutation: value: Handle, path: ArrayHandle
//     3. Deserialize mutation (store raw value and deserializer)
//         Mutation: value: Handle, deserializer: Deserializer, path: string[]
//     4. Apply mutation (deserialize value using type info)
//         Mutation: value: any, path: string[]
// 
// # Untyped workflow
// 
//     1. Create mutation (store raw value as plain object)
//         Mutation: value: any, type: null, path: string[]
//     2. Serialize mutation (serialize value using stored type)
//         Mutation: value: Handle using createAny, path: ArrayHandle
//     3. Deserialize mutation (store raw value and deserializer)
//         Mutation: value: Handle, deserializer: Deserializer, path: string[]
//     2. Apply mutation (apply raw value as plain object)
//         Mutation: value: any using parseAny, type: null, path: string[]

class _MutationType extends Type.ObjectType {
    protected _serialize(source: Mutation, serializer: Serializer<unknown, unknown, unknown, unknown>): unknown {
        const handle = super._serialize(source, serializer)
        const type = source.type

        // During serialization, the value must be serialized manually
        // since it's type is changes based on what was mutated

        if (source.kind == "assign") {
            const value = source.value
            const valueHandle = type != null ? (
                // If the type is known use it to serialize the value
                type["_serialize"](value, serializer)
            ) : (
                // Otherwise rely on the serializer to make something up
                serializer.createAny(value)
            )

            serializer.addObjectProperty(handle, "value", valueHandle)
            return handle
        }

        if (source.kind == "splice") {
            const items = source.items
            // If the items are empty, do not serialize them to save space
            if (items.length == 0) return handle
            const itemsHandle = serializer.createArray()

            for (const value of items) {
                const valueHandle = type != null ? (
                    // If the type is known use it to serialize the value
                    type["_serialize"](value, serializer)
                ) : (
                    // Otherwise rely on the serializer to make something up
                    serializer.createAny(value)
                )

                serializer.addArrayElement(itemsHandle, valueHandle)
            }

            serializer.addObjectProperty(handle, "items", itemsHandle)
            return handle
        }

        return handle
    }

    protected _deserialize(handle: any, deserializer: Deserializer<unknown, unknown, unknown, unknown>) {
        const result = super._deserialize(handle, deserializer) as Mutation
        result.deserializer = deserializer

        if (result.kind == "assign") {
            // We do not know the type of the modified value so we just save the handle
            result.value = deserializer.getObjectProperty(handle, "value")
        } else if (result.kind == "splice") {
            // For a splice mutation we need to get a separate handle for every element
            const baseHandle = deserializer.getObjectProperty(handle, "items")
            if (deserializer.isNull(baseHandle)) {
                // If the items were empty during serialization, the items property was not set so we have nothing to deserialize
                result.items = []
                return result
            }

            const itemsHandle = deserializer.parseArray(baseHandle)
            if (deserializer.isNull(itemsHandle)) {
                throw new DeserializationError("Expected items array").appendPath("items")
            }

            const items = Array.from(deserializer.getArrayElements(itemsHandle))
            result.items = items
        }

        return result
    }
}

const _MUTATION_TYPE: Struct.StructDefineOptions["baseTypeDecorator"] = (type) => {
    const name = type.name
    const props = { ...type.props }

    delete props.type
    delete props.deserializer

    if (type.name == "AssignMutation") {
        delete props.value
    } else if (type.name == "SpliceMutation") {
        delete props.items
    }

    return new _MutationType(name, props)
}

export namespace Mutation {
    abstract class _Mutation {
        public abstract type: Type | null | undefined
        public abstract deserializer: Deserializer | null | undefined
        public abstract path: string[]
    }

    export class AssignMutation extends Struct.define("AssignMutation", {
        ..._MUTATION_PROPS,
        key: Type.string,
        value: Type.any
    }, _Mutation, { baseTypeDecorator: _MUTATION_TYPE }) {
        public readonly kind = "assign"

        public serialize() {
            return Mutation_t.base.serialize(this)
        }
    }

    export class DeleteMutation extends Struct.define("DeleteMutation", {
        ..._MUTATION_PROPS,
        key: Type.string,
    }, _Mutation, { baseTypeDecorator: _MUTATION_TYPE }) {
        public readonly kind = "delete"

        public serialize() {
            return Mutation_t.base.serialize(this)
        }
    }

    export class SpliceMutation extends Struct.define("SpliceMutation", {
        ..._MUTATION_PROPS,
        index: Type.number,
        deleteCount: Type.number,
        items: Type.any.as(Type.array)
    }, _Mutation, { baseTypeDecorator: _MUTATION_TYPE }) {
        public readonly kind = "splice"

        public serialize() {
            return Mutation_t.base.serialize(this)
        }
    }

    function _isCompoundType(type: Type): type is Type.ArrayType<any> | Type.ObjectType | Type.MapType<any, any> {
        return Type.isArray(type) || Type.isObject(type) || Type.isMap(type)
    }

    function _invalidType(type: Type): never {
        throw new Error("Cannot mutate a type that is not an object, array, or map, " + type.name)
    }

    const _PATH = Symbol.for("struct.mutation.path")
    const _TYPE = Symbol.for("struct.mutation.type")
    function _makeProxy(object: any, _type: Type<any> | null, path: string[], mutations: Mutation[]): any {
        const type = _type == null ? null : Type.isNullable(_type) ? _type.base : _type

        // Type is not a compound path, we cannot access properties
        if (type != null && !_isCompoundType(type)) {
            return new Proxy({}, {
                get(target, key, receiver) {
                    // Return utility properties, used for example in `getPath`, `getThunkPath`, `getThunkType`
                    if (key == _PATH) return path
                    if (key == _TYPE) return type
                    _invalidType(type)
                },
                set() {
                    _invalidType(type)
                },
                deleteProperty() {
                    _invalidType(type)
                },
            })
        }

        if (typeof object != "object" || object == null) {
            const objectName = Object.prototype.toString.apply(object).slice(8, -1)
            return new Proxy({}, {
                get(target, key, receiver) {
                    // Return utility properties, used for example in `getPath`, `getThunkPath`, `getThunkType`
                    if (key == _PATH) return path
                    if (key == _TYPE) return type
                    throw new Error("Cannot access " + objectName)
                },
                set() {
                    throw new Error("Cannot access " + objectName)
                },
                deleteProperty() {
                    throw new Error("Cannot access " + objectName)
                },
            })
        }

        return new Proxy(object, {
            set(target, key, value, receiver) {
                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                // If the mutation is not dry, actually set the value
                if (target != DRY_MUTATION) {
                    const success = Reflect.set(target, key, value, receiver)
                    if (!success) {
                        // If we fail to set the value, not mutation occurred, so we can exit early
                        return false
                    }
                }

                const propertyType = type == null ? null : Type.isArray(type) ? type.elementType : Type.isObject(type) ? type.props[key] : _invalidType(type)

                mutations.push(new AssignMutation({
                    value, path, key,
                    type: propertyType
                }))

                return true
            },
            deleteProperty(target, key) {
                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                // If the mutation is not dry, actually delete the value
                if (target != DRY_MUTATION) {
                    const success = Reflect.deleteProperty(target, key)
                    if (!success) {
                        // If we fail to delete the value, not mutation occurred, so we can exit early
                        return false
                    }
                }

                mutations.push(new DeleteMutation({ path, key }))

                return true
            },
            get(target, key, receiver) {
                // Return utility properties, used for example in `getPath`, `getThunkPath`, `getThunkType`
                if (key == _PATH) return path
                if (key == _TYPE) return type

                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                // We return an actual value for some properties
                if (type == null ? target instanceof Array : Type.isArray(type)) {
                    // The actual value of length is needed for some array mutation methods, like push
                    if (key == "length") return target.length

                    const elementType = type == null ? null : (type as Type.ArrayType<any>).elementType

                    if (key == "splice") {
                        return function arraySplice(start: number, deleteCount: number, ...items: any[]) {
                            mutations.push(new SpliceMutation({
                                deleteCount, path, items,
                                index: start,
                                type: elementType
                            }))

                            if (target != DRY_MUTATION) target.splice(start, deleteCount, ...items)
                        }
                    }

                    if (key == "push") {
                        return function arrayPush(this: any[], ...items: any[]) {
                            // Pushing items is equivalent to inserting items at the end of the array
                            this.splice(this.length, 0, ...items)
                        }
                    }

                    // Check if the function is an array function, but we did not override it
                    if (key in []) throw new Error(`Unsupported array operation ${JSON.stringify(key)}`)
                } else if (type == null ? target instanceof Map : Type.isMap(type)) {
                    if (key == "size") return target.size

                    const mapType = type as Type.MapType<any, any> | null
                    if (mapType != null && mapType.keyType != Type.string && mapType.keyType != Type.atom) {
                        throw new Error("Mutations on maps with non-string keys are not supported")
                    }

                    const valueType = mapType == null ? null : mapType.valueType

                    if (key == "set") {
                        return function mapSet(key: string, value: any) {
                            mutations.push(new AssignMutation({
                                path, key, value,
                                type: valueType
                            }))

                            if (target != DRY_MUTATION) target.set(key, value)
                        }
                    }

                    if (key == "get") {
                        return function get(key: string) {
                            const value = target != DRY_MUTATION ? target.get(key) : DRY_MUTATION
                            return _makeProxy(value, valueType, [...path, key], mutations)
                        }
                    }

                    if (key == "clear") {
                        return function clear() {
                            // We don't want to make a separate mutation for clearing, so just reuse splice
                            mutations.push(new SpliceMutation({
                                deleteCount: -1,
                                index: 0,
                                items: [],
                                path,
                            }))

                            if (target != DRY_MUTATION) target.clear()
                        }
                    }
                    if (key == "delete") {
                        return function mapDelete(key: string) {
                            if (!target.has(key)) return false

                            mutations.push(new DeleteMutation({ key, path }))

                            if (target != DRY_MUTATION) target.delete(key)
                            return true
                        }
                    }

                    // Check if the function is a map function, but we did not override it
                    throw new Error(`Unsupported map operation ${JSON.stringify(key)}`)
                }

                const objectType = type as Type.ObjectType | null
                const propertyType = objectType == null ? null : objectType.props[key]

                return _makeProxy(target != DRY_MUTATION ? Reflect.get(target, key, receiver) : DRY_MUTATION, propertyType, [...path, key], mutations)
            }
        })
    }

    /** Creates a new mutation and if the target is not null also applies it. */
    export function create<T>(target: T | null, baseType: Type<any> | null, thunk: (proxy: T) => void) {
        const mutations: Mutation[] = []

        thunk(_makeProxy(target ?? DRY_MUTATION, baseType, [], mutations))

        return mutations
    }

    /** Typesafe way to get a path to a property */
    export function getPath<T>(baseType: Type<T>, thunk: (v: T) => any): string[]
    export function getPath<T = any>(baseType: null, thunk: (v: T) => any): string[]
    export function getPath(type: Type | null, thunk: (v: any) => any) {
        return thunk(_makeProxy(DRY_MUTATION, type, [], []))[_PATH]
    }

    export function getThunkPath(handle: any) {
        if (!(_PATH in handle)) throw new RangeError("Handle does not contain a path")
        return handle[_PATH] as string[]
    }

    export function getThunkType(handle: any) {
        if (!(_TYPE in handle)) throw new RangeError("Handle does not contain a type")
        const type = handle[_TYPE] as Type | null
        if (type == null) throw new TypeError("Thunk was created in using the untyped workflow, no type is available")
        return type
    }

    /** Applies a mutation to a target */
    export function apply(target: any, type: Type<any> | null, mutation: Mutation) {
        let receiver: any = target

        let index = -1

        for (const pathSegment of mutation.path) {
            index++

            if (type == null) {
                if (receiver instanceof Map) {
                    receiver = receiver.get(pathSegment)
                } else if (Array.isArray(receiver)) {
                    receiver = receiver[+pathSegment]
                } else {
                    receiver = receiver[pathSegment]
                }
                continue
            }

            if (Type.isMap(type)) {
                receiver = receiver.get(pathSegment)
                type = type.valueType
            } else if (Type.isArray(type)) {
                receiver = receiver[+pathSegment]
                type = type.elementType
            } else if (Type.isObject(type)) {
                const propertyType = type.props[pathSegment]
                if (propertyType == null) {
                    throw new Error(`Cannot mutate property "${pathSegment}" on type "${type.name}", property does not exist at ".${mutation.path.slice(0, index).join(".")}"`)
                }

                receiver = receiver[pathSegment]
                type = propertyType
            } else _invalidType(type)

            if (Type.isNullable(type)) {
                if (receiver == null) throw new Error(`Mutation target is null "${pathSegment}" at ".${mutation.path.slice(0, index).join(".")}"`)
                type = type.base
            }

            if (!_isCompoundType(type)) throw new Error(`Invalid mutation target "${pathSegment}" at ".${mutation.path.slice(0, index).join(".")}"`)
        }

        if (mutation.kind == "assign") {
            const key = mutation.key

            if (type == null) {
                // If the deserializer is null, the mutation has not been serialized and is used locally, otherwise the value is a handle and needs to be deserialized
                const value = mutation.deserializer == null ? mutation.value : mutation.deserializer.parseAny(mutation.value)

                if (Array.isArray(receiver)) {
                    receiver[+key] = value
                } else if (receiver instanceof Map) {
                    receiver.set(key, value)
                } else {
                    receiver[key] = value
                }

                return
            }

            if (Type.isObject(type)) {
                const propertyType = type.props[key]
                if (propertyType == null) {
                    throw new Error(`Cannot mutate property "${key}" on type "${type.name}", property does not exist at "${mutation.path.join(".")}.${key}"`)
                }

                // If the deserializer is null, the mutation has not been serialized and is used locally, otherwise the value is a handle and needs to be deserialized
                const value = mutation.deserializer == null ? mutation.value : propertyType["_deserialize"](mutation.value, mutation.deserializer)
                receiver[key] = value
            } else if (Type.isArray(type)) {
                const elementType = type.elementType
                const value = mutation.deserializer == null ? mutation.value : elementType["_deserialize"](mutation.value, mutation.deserializer)
                receiver[+key] = value
            } else if (Type.isMap(type)) {
                const valueType = type.valueType
                const value = mutation.deserializer == null ? mutation.value : valueType["_deserialize"](mutation.value, mutation.deserializer)
                receiver.set(key, value)
            } else throw new Error(`Cannot use assign on type ${type.name} at ".${mutation.path.join(".")}.${key}"`)

            return
        }

        if (mutation.kind == "splice") {
            const { deleteCount, index, deserializer } = mutation

            if (type == null) {
                const items = deserializer == null ? mutation.items : mutation.items.map(v => deserializer.parseAny(v))

                if (Array.isArray(receiver)) {
                    receiver.splice(index, deleteCount, ...items)
                } else if (receiver instanceof Map) {
                    // We don't want to make a separate mutation for clearing, so just reuse splice
                    receiver.clear()
                } else throw new Error(`Cannot use splice at "${mutation.path.join(".")}"`)

                return
            }

            if (Type.isArray(type)) {
                const elementType = type.elementType
                const items = deserializer == null ? mutation.items : mutation.items.map(v => elementType["_deserialize"](v, deserializer))
                receiver.splice(index, deleteCount, ...items)
            } else if (Type.isMap(type)) {
                receiver.clear()
            } else throw new Error(`Cannot use splice on type "${type.name}" at ".${mutation.path.join(".")}"`)

            return
        }

        if (mutation.kind == "delete") {
            const { key } = mutation

            if (type == null) {
                if (receiver instanceof Map) {
                    receiver.delete(key)
                } else {
                    delete receiver[key]
                }

                return
            }

            if (Type.isObject(type)) {
                delete receiver[key]
            } else if (Type.isMap(type)) {
                receiver.delete(key)
            } else throw new Error(`Cannot use splice on type "${type.name}" at ".${mutation.path.join(".")}"`)

            return
        } else throw new Error(`Invalid mutation type ${JSON.stringify((mutation as any).type)}`)
    }
}

export type Mutation = Mutation.AssignMutation | Mutation.DeleteMutation | Mutation.SpliceMutation
export const Mutation_t = new Struct.PolymorphicSerializer<Mutation>("Mutation")
Mutation_t.register(Mutation.AssignMutation)
Mutation_t.register(Mutation.DeleteMutation)
Mutation_t.register(Mutation.SpliceMutation)

