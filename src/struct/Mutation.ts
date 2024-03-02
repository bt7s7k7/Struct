import { unreachable } from "../comTypes/util"
import { Type } from "../struct/Type"
import { Struct } from "./Struct"

function getSetEntryAtIndex<T>(set: Set<T>, index: number) {
    let i = 0

    for (const entry of set.values()) {
        if (i == index) return entry
        i++
    }

    return undefined
}

function findSetEntryIndex<T>(set: Set<T>, target: T) {
    let i = 0
    for (const entry of set.values()) {
        if (entry == target) return i
        i++
    }

    return undefined
}

const DRY_MUTATION = {}

export namespace Mutation {
    abstract class _AnyMutation {
        public isLocal = false
        public setLocal(): this {
            this.isLocal = true
            return this
        }
    }

    export class AssignMutation extends Struct.define("AssignMutation", {
        type: Type.enum("mut_assign"),
        value: Type.passthrough<any>(null),
        key: Type.string,
        path: Type.string.as(Type.array)
    }, _AnyMutation) { }

    export class SpliceMutation extends Struct.define("SpliceMutation", {
        type: Type.enum("mut_splice"),
        index: Type.number,
        deleteCount: Type.number,
        items: Type.passthrough<any>(null).as(Type.array),
        path: Type.string.as(Type.array)
    }, _AnyMutation) { }

    export class DeleteMutation extends Struct.define("DeleteMutation", {
        type: Type.enum("mut_delete"),
        key: Type.string,
        path: Type.string.as(Type.array)
    }, _AnyMutation) { }

    export type AnyMutation = AssignMutation | SpliceMutation | DeleteMutation
    export const AnyMutation_t = Type.byKeyUnion("AnyMutation", "type", {
        "mut_assign": AssignMutation.ref(),
        "mut_splice": SpliceMutation.ref(),
        "mut_delete": DeleteMutation.ref()
    }, () => unreachable())

    const _PATH = Symbol.for("struct.mutation.path")
    function _makeProxy(object: any, _type: Type<any> | null, path: string[], mutations: AnyMutation[]): any {
        const type = _type == null ? null : Type.isNullable(_type) ? _type.base : _type

        if (
            type != null &&
            !Type.isArray(type) &&
            !Type.isObject(type) &&
            !Type.isRecord(type) &&
            !Type.isMap(type) &&
            !Type.isSet(type)
        ) {
            return new Proxy(object, {
                get(target, key, receiver) {
                    if (key == _PATH) return path
                    throw new Error("Cannot mutate a type that is not an object, array, set, map or record, " + type.name)
                },
                set() {
                    throw new Error("Cannot mutate a type that is not an object, array, set, map or record, " + type.name)
                },
                deleteProperty() {
                    throw new Error("Cannot mutate a type that is not an object, array, set, map or record, " + type.name)
                },
            })
        }

        return new Proxy(object, {
            set(target, key, value, receiver) {
                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                if (target != DRY_MUTATION) if (!Reflect.set(target, key, value, receiver)) return false

                const serializedValue = type == null ? value : !Type.isObject(type) ? type.type.serialize(value) : type.props[key].serialize(value)

                mutations.push(new AssignMutation({
                    type: "mut_assign",
                    value: serializedValue,
                    path, key
                }).setLocal())

                return true
            },
            deleteProperty(target, key) {
                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                if (target != DRY_MUTATION) if (!Reflect.deleteProperty(target, key)) return false

                mutations.push(new DeleteMutation({
                    type: "mut_delete",
                    path, key
                }).setLocal())

                return true
            },
            get(target, key, receiver) {
                if (key == _PATH) return path
                if (typeof key == "symbol") throw new Error("Cannot mutate a symbol indexed property")

                if (type == null ? target instanceof Array : Type.isArray(type)) {
                    if (key == "length") return target.length

                    const func = ({
                        splice(start: number, deleteCount: number, ...items: any[]) {
                            mutations.push(new SpliceMutation({
                                type: "mut_splice",
                                deleteCount, path,
                                index: start,
                                items: type == null ? items : (type as Type.ArrayType).serialize(items)
                            }).setLocal())

                            if (target != DRY_MUTATION) target.splice(start, deleteCount, ...items)
                        },
                        push(...items) {
                            this.splice(this.length, 0, ...items)
                        }
                    } as Partial<any[]>)[key as any]

                    if (func) return func

                    if (key in []) throw new Error(`Unsupported array operation ${JSON.stringify(key)}`)
                } else if (type == null ? target instanceof Map : Type.isMap(type)) {
                    if (key == "size") return target.size

                    const func = (({
                        set(key, value) {
                            mutations.push(new AssignMutation({
                                type: "mut_assign",
                                path, key,
                                value: type == null ? value : type.serialize(value)
                            }).setLocal())

                            if (target != DRY_MUTATION) target.set(key, value)
                        },
                        get(key) {
                            const value = target != DRY_MUTATION ? target.get(key) : DRY_MUTATION
                            return _makeProxy(value, type == null ? null : (type as Type.MapType).type, [...path, key], mutations)
                        },
                        clear() {
                            mutations.push(new SpliceMutation({
                                type: "mut_splice",
                                deleteCount: -1,
                                index: 0,
                                items: [],
                                path,
                            }).setLocal())

                            if (target != DRY_MUTATION) target.clear()
                        },
                        delete(key) {
                            if (!target.has(key)) return false
                            mutations.push(new DeleteMutation({
                                type: "mut_delete",
                                key, path,
                            }).setLocal())

                            if (target != DRY_MUTATION) target.delete(key)
                            return true
                        }
                    } as Partial<Map<string, any>>) as any)[key]

                    if (func) return func

                    throw new Error(`Unsupported map operation ${JSON.stringify(key)}`)
                } else if (type == null ? target instanceof Set : Type.isSet(type)) {
                    if (key == "size") return target.size

                    const func = (({
                        add(value) {
                            if (target.has(value)) return
                            mutations.push(new SpliceMutation({
                                type: "mut_splice",
                                deleteCount: 0,
                                index: 0,
                                items: [
                                    type == null ? value : (type as Type.SetType).type.serialize(value)
                                ],
                                path,
                            }).setLocal())

                            if (target != DRY_MUTATION) target.add(value)
                        },
                        clear() {
                            mutations.push(new SpliceMutation({
                                type: "mut_splice",
                                deleteCount: -1,
                                index: 0,
                                items: [],
                                path,
                            }).setLocal())

                            if (target != DRY_MUTATION) target.clear()
                        },
                        delete(entry) {
                            if (!target.has(entry)) return false
                            const index = findSetEntryIndex(target, entry)
                            if (index == undefined) throw new Error("Didn't find entry index, even though the set has it")

                            mutations.push(new SpliceMutation({
                                type: "mut_splice",
                                index, path,
                                deleteCount: 1,
                                items: []
                            }).setLocal())

                            if (target != DRY_MUTATION) target.delete(entry)
                            return true
                        }
                    } as Partial<Set<any>>) as any)[key]

                    if (func) return func

                    throw new Error(`Unsupported map operation ${JSON.stringify(key)}`)
                }

                const propertyType = type == null ? null : Type.isObject(type) ? type.props[key] : type.type
                return _makeProxy(target != DRY_MUTATION ? Reflect.get(target, key, receiver) : DRY_MUTATION, propertyType, [...path, key], mutations)
            }
        })
    }

    export function create<T>(target: T | null, baseType: Type<any> | null, thunk: (proxy: T) => void) {
        const mutations: AnyMutation[] = []

        thunk(_makeProxy(target ?? DRY_MUTATION, baseType, [], mutations))

        return mutations
    }

    export type TypedPath<T = any> = T extends string | number | boolean | symbol | null | void | undefined ? T & { [_PATH]: string[] } : { [P in keyof T]: TypedPath<T[P]> } & { [_PATH]: string[] }
    export function getPath(path: TypedPath) {
        return path[_PATH]
    }
    export function typedPath<T>(baseType: Type<T>) {
        return _makeProxy(DRY_MUTATION, baseType, [], []) as TypedPath<T>
    }

    export function apply(target: any, type: Type<any> | null, mutation: AnyMutation) {
        let receiver: any = target

        mutation.path.forEach((prop, i) => {
            receiver = type == null ? receiver[prop] : Type.isMap(type) ? receiver.get(prop)
                : Type.isSet(type) ? getSetEntryAtIndex(receiver, +prop)
                    : receiver[prop]

            if (type == null) return

            let newType = (Type.isObject(type) ? type.props[prop] : (type as Type.ArrayType).type)

            if (Type.isNullable(newType)) {
                if (receiver == null) throw new Error(`Mutation target is null "${prop}" at .${mutation.path.slice(0, i).join(".")}`)
                newType = newType.base
            }

            if (!newType || (
                !Type.isObject(newType) &&
                !Type.isArray(newType) &&
                !Type.isRecord(newType) &&
                !Type.isMap(newType) &&
                !Type.isSet(newType)
            )) throw new Error(`Invalid mutation target "${prop}" at .${mutation.path.slice(0, i).join(".")}`)
            type = newType
        })

        if (mutation.type == "mut_assign") {
            if (type == null) {
                receiver[mutation.key] = mutation.value
            } else if (Type.isObject(type) || Type.isArray(type) || Type.isRecord(type)) {
                const valueType = Type.isObject(type) ? type.props[mutation.key] : type.type
                receiver[mutation.key] = mutation.isLocal ? mutation.value : valueType.deserialize(mutation.value)
            } else if (Type.isMap(type)) {
                receiver.set(mutation.key, mutation.isLocal ? mutation.value : type.type.deserialize(mutation.value))
            } else throw new Error("Cannot use assign on type " + type.name)
        } else if (mutation.type == "mut_splice") {
            if (type == null) {
                receiver.splice(mutation.index, mutation.deleteCount, ...mutation.items)
            } else if (Type.isArray(type)) {
                const items = mutation.isLocal ? mutation.items : type.deserialize(mutation.items)
                receiver.splice(mutation.index, mutation.deleteCount, ...items)
            } else if (Type.isSet(type)) {
                if (mutation.deleteCount == -1) receiver.clear()
                else if (mutation.index == 0 && mutation.deleteCount == 0) receiver.add(mutation.isLocal ? mutation.items[0] : type.deserialize(mutation.items[0]))
                else if (mutation.deleteCount == 1) receiver.delete(getSetEntryAtIndex(receiver, mutation.index))
                else throw new Error(`Invalid set message (index = ${mutation.index}; deleteCount = ${mutation.deleteCount})`)
            } else if (Type.isMap(type)) {
                receiver.clear()
            } else throw new Error("Cannot use splice on type" + type.name)
        } else if (mutation.type == "mut_delete") {
            if (type == null) {
                delete receiver[mutation.key]
            } else if (Type.isObject(type) || Type.isRecord(type)) {
                delete receiver[mutation.key]
            } else if (Type.isMap(type)) {
                receiver.delete(mutation.key)
            } else throw new Error("Cannot use delete on type " + type.name)
        } else throw new Error(`Unknown mutation type ${JSON.stringify((mutation as any).type)}`)
    }
}
