import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Encounter Builder — an editor for scene-linked encounter tables.
 *
 * Encounters are stored as ordinary RollTables so they keep every core feature
 * (weights, no-replacement, compendium export, and the module's per-Region
 * overrides). What core lacks is a way to attach a scene and its trimmings to a
 * result: its sheet only links a document if you happen to drag one onto it,
 * and has nowhere to put a playlist, journal, or GM note. Those live in module
 * flags on each result, written here.
 */
export class EncounterBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "scorpious-pipboy-encounter-builder",
		tag: "form",
		window: { title: "Pip-Boy Encounter Builder", icon: "fas fa-skull" },
		position: { width: 860, height: "auto" },
		form: {
			handler: EncounterBuilder.#onSubmit,
			closeOnSubmit: false,
		},
		actions: {
			useForTravel: EncounterBuilder.#onUseForTravel,
			addRow: EncounterBuilder.#onAddRow,
			removeRow: EncounterBuilder.#onRemoveRow,
			createTable: EncounterBuilder.#onCreateTable,
		},
	};

	static PARTS = {
		form: { template: `modules/${MODULE_ID}/templates/encounter-builder.hbs` },
	};

	/** Rows being edited. Held in memory so adding a row doesn't need a save. */
	#rows = null;

	/** The table currently being edited. */
	get table() {
		const uuid = game.settings.get(MODULE_ID, "encounterBuilderTableUuid");
		return uuid ? fromUuidSync(uuid) : null;
	}

	/** Read the table's results into editable rows. */
	#loadRows(table) {
		if (!table) return [];
		return table.results.contents
			.sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))
			.map((result) => {
				const flags = result.flags?.[MODULE_ID] ?? {};
				return {
					id: result.id,
					name: result.name || result.description || "",
					weight: result.weight ?? 1,
					sceneUuid: flags.sceneUuid ?? result.documentUuid ?? "",
					playlistUuid: flags.playlistUuid ?? "",
					journalUuid: flags.journalUuid ?? "",
					notes: flags.notes ?? "",
				};
			});
	}

	async _prepareContext() {
		const table = this.table;
		if (this.#rows === null) this.#rows = this.#loadRows(table);

		const options = (collection, selected) => [
			{ uuid: "", name: "— None —", selected: !selected },
			...collection.map((doc) => ({
				uuid: doc.uuid,
				name: doc.name,
				selected: doc.uuid === selected,
			})),
		];

		const travelTableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
		return {
			hasTable: !!table,
			tableName: table?.name ?? "",
			// The builder edits one table; travel draws from another setting.
			// Show which, so a built table that nothing uses is obvious.
			isTravelTable: !!table && table.uuid === travelTableUuid,
			travelTableName: travelTableUuid
				? (fromUuidSync(travelTableUuid)?.name ?? "a missing table")
				: "",
			tables: game.tables.map((t) => ({
				uuid: t.uuid,
				name: t.name,
				selected: t.uuid === game.settings.get(MODULE_ID, "encounterBuilderTableUuid"),
			})),
			rows: this.#rows.map((row, index) => ({
				...row,
				index,
				scenes: options(game.scenes, row.sceneUuid),
				playlists: options(game.playlists, row.playlistUuid),
				journals: options(game.journal, row.journalUuid),
			})),
		};
	}

	/** Pull the form's current values back into memory, so a re-render (adding
	 *  or removing a row) doesn't discard unsaved edits. */
	#captureForm() {
		const form = this.element;
		if (!form) return;
		this.#rows = this.#rows.map((row, index) => ({
			...row,
			name: form.querySelector(`[name="row.${index}.name"]`)?.value ?? row.name,
			weight: Number(form.querySelector(`[name="row.${index}.weight"]`)?.value) || 1,
			sceneUuid: form.querySelector(`[name="row.${index}.sceneUuid"]`)?.value ?? "",
			playlistUuid: form.querySelector(`[name="row.${index}.playlistUuid"]`)?.value ?? "",
			journalUuid: form.querySelector(`[name="row.${index}.journalUuid"]`)?.value ?? "",
			notes: form.querySelector(`[name="row.${index}.notes"]`)?.value ?? "",
		}));
	}

	static #onAddRow() {
		this.#captureForm();
		this.#rows.push({
			id: null, name: "New Encounter", weight: 1,
			sceneUuid: "", playlistUuid: "", journalUuid: "", notes: "",
		});
		this.render();
	}

	static #onRemoveRow(event, target) {
		this.#captureForm();
		const index = Number(target.dataset.index);
		if (Number.isInteger(index)) this.#rows.splice(index, 1);
		this.render();
	}

	/** Point travel's encounter rolls at the table being edited. */
	static async #onUseForTravel() {
		const table = this.table;
		if (!table) return;
		await game.settings.set(MODULE_ID, "encounterTableUuid", table.uuid);
		ui.notifications?.info(`"${table.name}" is now the default encounter table for travel.`);
		this.render();
	}

	/** Create a fresh encounter table and start editing it. */
	static async #onCreateTable() {
		const table = await RollTable.create({
			name: "Pip-Boy Encounters",
			description: "Scene-linked wasteland encounters, built by the Pip-Boy.",
			formula: "1d100",
			replacement: true,
		});
		if (!table) return;
		await game.settings.set(MODULE_ID, "encounterBuilderTableUuid", table.uuid);
		// Also point travel at it: building a table and having nothing use it is
		// the obvious trap here.
		await game.settings.set(MODULE_ID, "encounterTableUuid", table.uuid);
		ui.notifications?.info(`"${table.name}" is now the default encounter table for travel.`);
		this.#rows = [];
		this.render();
	}

	/**
	 * Write every row back to the table.
	 *
	 * Weights become contiguous ranges covering 1..total: core will happily
	 * store gaps, and a draw that lands in one silently returns nothing, so the
	 * ranges are always rebuilt from scratch rather than patched.
	 */
	static async #onSubmit(event, form, formData) {
		const d = formData.object;

		// Switching the edited table is a load, not a save.
		const chosen = d.tableUuid ?? "";
		if (chosen !== game.settings.get(MODULE_ID, "encounterBuilderTableUuid")) {
			await game.settings.set(MODULE_ID, "encounterBuilderTableUuid", chosen);
			this.#rows = null;
			return this.render();
		}

		const table = this.table;
		if (!table) return;

		this.#captureForm();
		const rows = this.#rows.filter((row) => (row.name ?? "").trim().length);
		if (!rows.length) {
			ui.notifications?.warn("Add at least one encounter before saving.");
			return;
		}

		// Rebuild ranges so they tile 1..total with no gaps or overlaps.
		let cursor = 1;
		const ranges = rows.map((row) => {
			const weight = Math.max(1, Math.round(Number(row.weight) || 1));
			const range = [cursor, (cursor + weight) - 1];
			cursor += weight;
			return { weight, range };
		});
		const total = cursor - 1;

		const buildData = (row, i) => ({
			name: row.name,
			weight: ranges[i].weight,
			range: ranges[i].range,
			// documentUuid is set too, so a scene-linked result still reads as a
			// document link on core's own sheet.
			...(row.sceneUuid
				? { type: CONST.TABLE_RESULT_TYPES.DOCUMENT, documentUuid: row.sceneUuid }
				: { type: CONST.TABLE_RESULT_TYPES.TEXT, documentUuid: null }),
			[`flags.${MODULE_ID}`]: {
				sceneUuid: row.sceneUuid || null,
				playlistUuid: row.playlistUuid || null,
				journalUuid: row.journalUuid || null,
				notes: row.notes || "",
			},
		});

		const updates = [];
		const creations = [];
		rows.forEach((row, i) => {
			if (row.id && table.results.get(row.id)) updates.push({ _id: row.id, ...buildData(row, i) });
			else creations.push(buildData(row, i));
		});

		// Anything no longer in the editor has been removed.
		const keptIds = new Set(rows.map((row) => row.id).filter(Boolean));
		const deletions = table.results.contents
			.filter((result) => !keptIds.has(result.id))
			.map((result) => result.id);

		if (deletions.length) await table.deleteEmbeddedDocuments("TableResult", deletions);
		if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
		if (creations.length) await table.createEmbeddedDocuments("TableResult", creations);
		// The formula has to span the ranges or draws fall in the gaps.
		await table.update({ formula: `1d${total}` });

		this.#rows = null;
		ui.notifications?.info(`Saved ${rows.length} encounters to "${table.name}".`);
		this.render();
	}
}
