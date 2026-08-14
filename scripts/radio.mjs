import { MODULE_ID } from "./constants.mjs";

/**
 * Client-local Pip-Boy radio.
 *
 * Stations are Playlists inside the playlist folder named by the "radioFolder"
 * world setting. Playback happens purely on this client via foundry.audio —
 * the Playlist documents themselves are never started or stopped, so nothing
 * is broadcast and other users hear nothing.
 */
export class PipBoyRadio {
	/** Playlist id currently tuned, or null. */
	static station = null;

	/** Whether the radio is on. */
	static playing = false;

	/** Re-render callback, wired to PipBoyApp.refreshAll() at init (a direct
	 *  import here would create a module cycle). */
	static onUpdate = () => {};

	/** @type {foundry.audio.Sound|null} the live sound */
	static #sound = null;

	/** Remaining tracks in the current rotation: [{ name, path }] */
	static #queue = [];

	/** Currently playing track, or null. */
	static #track = null;

	static get volume() {
		return game.settings.get(MODULE_ID, "radioVolume") ?? 0.5;
	}

	static get nowPlaying() {
		return this.#track?.name ?? null;
	}

	static get folderName() {
		return game.settings.get(MODULE_ID, "radioFolder") || "Pip-Boy Radio";
	}

	/** Playlists that count as radio stations. */
	static stations() {
		const folderName = this.folderName.toLowerCase();
		return game.playlists.filter((p) => p.folder?.name?.toLowerCase() === folderName);
	}

	/** Tune to a station; tuning the active station switches the radio off. */
	static async tune(playlistId) {
		if (this.station === playlistId && this.playing) return this.stop();
		await this.#halt();
		const playlist = game.playlists.get(playlistId);
		if (!playlist) return;
		this.station = playlistId;
		this.playing = true;
		this.#queue = this.#buildQueue(playlist);
		return this.next();
	}

	/** Advance to the next track, rebuilding the rotation when it runs out. */
	static async next(attempts = 0) {
		if (!this.playing) return;
		if (attempts > 20) return this.stop();
		await this.#halt();
		if (!this.#queue.length) {
			const playlist = game.playlists.get(this.station);
			this.#queue = playlist ? this.#buildQueue(playlist) : [];
			if (!this.#queue.length) return this.stop();
		}
		const track = this.#queue.shift();
		this.#track = track;
		try {
			// push=false: play locally only, never over the socket.
			const sound = await foundry.audio.AudioHelper.play(
				{ src: track.path, volume: this.volume, autoplay: true, loop: false },
				false,
			);
			this.#sound = sound ?? null;
			sound?.addEventListener?.("end", () => {
				if (this.#sound === sound) this.next();
			});
		} catch (_e) {
			// Unplayable track (missing file, bad codec): skip ahead.
			return this.next(attempts + 1);
		}
		this.onUpdate();
	}

	/** Switch the radio off. */
	static async stop() {
		this.playing = false;
		await this.#halt();
		this.onUpdate();
	}

	/** Live volume change for the playing track (persisting is the caller's job). */
	static setVolume(v) {
		try {
			if (this.#sound) this.#sound.volume = v;
		} catch (_e) { /* sound already gone */ }
	}

	static #buildQueue(playlist) {
		const sounds = playlist.sounds.contents
			.filter((s) => s.path)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
			.map((s) => ({ name: s.name, path: s.path }));
		// Shuffle-mode playlists get a shuffled rotation; others play in order.
		if (playlist.mode === CONST.PLAYLIST_MODES.SHUFFLE) {
			for (let i = sounds.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[sounds[i], sounds[j]] = [sounds[j], sounds[i]];
			}
		}
		return sounds;
	}

	static async #halt() {
		const sound = this.#sound;
		this.#sound = null;
		this.#track = null;
		try {
			sound?.stop();
		} catch (_e) { /* already stopped */ }
	}
}
