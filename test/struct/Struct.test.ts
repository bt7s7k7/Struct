import { expect } from "chai"
import { Struct } from "../../src/struct/Struct"
import { Type } from "../../src/struct/Type"
import { describeMember } from "../testUtil/describeMember"

describeMember(() => Struct, () => {
    function makeStruct() {
        class Test extends Struct.define("Test", {
            name: Type.string,
            height: Type.number,
            nicknames: Type.string.as(Type.array),
            homes: Type.object({
                address: Type.string,
                doorSize: Type.number.as(Type.nullable)
            }).as(Type.record)
        }) { }

        return { Test }
    }

    it("Should be able to make a struct", () => {
        const { Test } = makeStruct()

        expect(Test).to.be.not.null

        expect(Test.default().serialize()).to.deep.equal({ name: "", height: 0, nicknames: [], homes: {} })

        const source = {
            name: "foo",
            height: 52,
            nicknames: ["boo", "bar"],
            homes: {
                one: {
                    address: "foo",
                    doorSize: 12
                },
                two: {
                    address: "boo",
                    doorSize: 81
                }
            }
        }

        const test = Test.deserialize(source)

        expect(test).to.be.instanceOf(Test)
        expect(test.serialize()).to.deep.equal(source)
    })

    it("Should be able to use a struct in a type definition", () => {
        const { Test } = makeStruct()

        class Deriv extends Struct.define("Deriv", {
            test: Test.ref()
        }) { }

        const deriv = Deriv.default()

        expect(deriv.test).to.be.instanceOf(Test)

        expect(Deriv.deserialize(Deriv.default().serialize())).to.be.instanceOf(Deriv)
    })
})