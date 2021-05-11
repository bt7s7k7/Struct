/* eslint-disable no-console */
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "../structSync/ActionType"
import { StructSyncContract } from "../structSync/StructSyncContract"

void (async () => {
    class Test extends Struct.define("Test", {
        name: Type.string,
        height: Type.number,
        nicknames: Type.string.as(Type.array),
        homes: Type.object({
            address: Type.string,
            doorSize: Type.number.as(Type.nullable)
        }).as(Type.record)
    }) { }

    console.log(Test.definition)
    console.log(Test.default())
    console.log(Test.default().serialize())

    console.log(Test.deserialize({
        name: "",
        height: 0,
        nicknames: [],
        homes: {}
    }))

    class Deriv extends Struct.define("Deriv", {
        test: Test.ref()
    }) { }

    console.log(Deriv.deserialize(Deriv.default().serialize()))

    type _1 = Struct.BaseType<typeof Test>

    class Track extends Struct.define("Track", {
        name: Type.string,
        artist: Type.string,
        icon: Type.string
    }) { }

    class Playlist extends Struct.define("Playlist", {
        name: Type.string,
        icon: Type.string,
        tracks: Track.ref().as(Type.array)
    }) { }

    const PlaylistContract = StructSyncContract.define(Playlist, {
        removeTrack: ActionType.define("removeTrack", Type.object({ index: Type.number }), Type.empty)
    })

    class PlaylistProxy extends PlaylistContract.defineProxy() { }
    class PlaylistController extends PlaylistContract.defineController() {
        public impl = super.impl({
            async removeTrack({ index }) {

            }
        })
    }
    const playlistController = PlaylistController.default()

    // eslint-disable-next-line
    if (![]) {
        const playlistProxy = await PlaylistProxy.make()

        console.log(playlistProxy.tracks)

        await playlistProxy.removeTrack({ index: 1 })

        console.log(playlistProxy.tracks)
    }
})().catch(err => console.error(err))