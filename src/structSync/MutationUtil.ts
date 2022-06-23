import { Type } from "../struct/Type"
import { StructSyncMessages } from "./StructSyncMessages"

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

export namespace MutationUtil {
    export function runMutationThunk<T>(targetName: string, target: T | null, baseType: Type<any>, thunk: (proxy: T) => void) {
        const mutations: StructSyncMessages.AnyMutateMessage[] = []

        const makeProxy = (object: any, _type: Type<any>, path: string[]): any => {
            const type = Type.isNullable(_type) ? _type.base : _type

            if (
                !Type.isArray(type) &&
                !Type.isObject(type) &&
                !Type.isRecord(type) &&
                !Type.isMap(type) &&
                !Type.isSet(type)
            ) {
                throw new Error("Cannot mutate a type that is not an object, array, set, map or record, " + type.name)
            }

            return new Proxy(object, {
                set(target, key, value, receiver) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (target != DRY_MUTATION) if (!Reflect.set(target, key, value, receiver)) return false

                    const serializedValue = !Type.isObject(type) ? type.type.serialize(value) : type.props[key].serialize(value)

                    mutations.push({
                        type: "mut_assign",
                        target: targetName,
                        value: serializedValue,
                        path, key
                    })

                    return true
                },
                deleteProperty(target, key) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (target != DRY_MUTATION) if (!Reflect.deleteProperty(target, key)) return false

                    mutations.push({
                        type: "mut_delete",
                        target: targetName,
                        path, key
                    })

                    return true
                },
                get(target, key, receiver) {
                    if (typeof key == "symbol") throw new Error("Cannon mutate a symbol indexed property")

                    if (Type.isArray(type)) {
                        if (key == "length") return target.length

                        const func = ({
                            splice(start: number, deleteCount: number, ...items: any[]) {
                                mutations.push({
                                    type: "mut_splice",
                                    deleteCount, path,
                                    target: targetName,
                                    index: start,
                                    items: type.serialize(items)
                                })

                                if (target != DRY_MUTATION) target.splice(start, deleteCount, ...items)
                            },
                            push(...items) {
                                this.splice(this.length, 0, ...items)
                            }
                        } as Partial<any[]>)[key as any]

                        if (func) return func

                        if (key in []) throw new Error(`Unsupported array operation ${JSON.stringify(key)}`)
                    } else if (Type.isMap(type)) {
                        if (key == "size") return target.size

                        const func = (({
                            set(key, value) {
                                mutations.push({
                                    type: "mut_assign",
                                    path, key,
                                    target: targetName,
                                    value: type.type.serialize(value)
                                })

                                if (target != DRY_MUTATION) target.set(key, value)
                            },
                            get(key) {
                                const value = target != DRY_MUTATION ? target.get(key) : DRY_MUTATION
                                return makeProxy(value, type.type, [...path, key])
                            },
                            clear() {
                                mutations.push({
                                    type: "mut_splice",
                                    deleteCount: -1,
                                    index: 0,
                                    items: [],
                                    path,
                                    target: targetName
                                })

                                if (target != DRY_MUTATION) target.clear()
                            },
                            delete(key) {
                                if (!target.has(key)) return false
                                mutations.push({
                                    type: "mut_delete",
                                    key, path,
                                    target: targetName
                                })

                                if (target != DRY_MUTATION) target.delete(key)
                                return true
                            }
                        } as Partial<Map<string, any>>) as any)[key]

                        if (func) return func

                        throw new Error(`Unsupported map operation ${JSON.stringify(key)}`)
                    } else if (Type.isSet(type)) {
                        if (key == "size") return target.size

                        const func = (({
                            add(value) {
                                if (target.has(value)) return
                                mutations.push({
                                    type: "mut_splice",
                                    deleteCount: 0,
                                    index: 0,
                                    items: [
                                        type.type.serialize(value)
                                    ],
                                    path,
                                    target: targetName
                                })

                                if (target != DRY_MUTATION) target.add(value)
                            },
                            clear() {
                                mutations.push({
                                    type: "mut_splice",
                                    deleteCount: -1,
                                    index: 0,
                                    items: [],
                                    path,
                                    target: targetName
                                })

                                if (target != DRY_MUTATION) target.clear()
                            },
                            delete(entry) {
                                if (!target.has(entry)) return false
                                const index = findSetEntryIndex(target, entry)
                                if (index == undefined) throw new Error("Didn't find entry index, even though the set has it")

                                mutations.push({
                                    type: "mut_splice",
                                    index, path,
                                    deleteCount: 1,
                                    target: targetName,
                                    items: []
                                })

                                if (target != DRY_MUTATION) target.delete(entry)
                                return true
                            }
                        } as Partial<Set<any>>) as any)[key]

                        if (func) return func

                        throw new Error(`Unsupported map operation ${JSON.stringify(key)}`)
                    }

                    return makeProxy(target != DRY_MUTATION ? Reflect.get(target, key, receiver) : DRY_MUTATION, Type.isObject(type) ? type.props[key] : type.type, [...path, key])
                }
            })
        }

        thunk(makeProxy(target ?? DRY_MUTATION, baseType, []))

        return mutations
    }

    export function applyMutation(target: any, type: Type.ObjectType | Type.ArrayType | Type.RecordType | Type.MapType | Type.SetType | null, mutation: StructSyncMessages.AnyMutateMessage) {
        let receiver: any = target

        mutation.path.forEach((prop, i) => {
            receiver = type == null ? receiver[prop] : Type.isMap(type) ? receiver.get(prop)
                : Type.isSet(type) ? getSetEntryAtIndex(receiver, +prop)
                    : receiver[prop]

            if (type == null) return

            let newType = (Type.isObject(type) ? type.props[prop] : type.type)

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
                receiver[mutation.key] = valueType.deserialize(mutation.value)
            } else if (Type.isMap(type)) {
                receiver.set(mutation.key, type.type.deserialize(mutation.value))
            } else throw new Error("Cannot use assign on type " + type.name)
        } else if (mutation.type == "mut_splice") {
            if (type == null) {
                receiver.splice(mutation.index, mutation.deleteCount, ...mutation.items)
            } else if (Type.isArray(type)) {
                receiver.splice(mutation.index, mutation.deleteCount, ...type.deserialize(mutation.items))
            } else if (Type.isSet(type)) {
                if (mutation.deleteCount == -1) receiver.clear()
                else if (mutation.index == 0 && mutation.deleteCount == 0) receiver.add(type.deserialize(mutation.items[0]))
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