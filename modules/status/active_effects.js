import DSA5 from "../system/config-dsa5.js"

const callMacro = async(packName, name, actor, item, qs, args = {}) => {
    let result = {}
    if (!game.user.can("MACRO_SCRIPT")) {
        ui.notifications.warn(`You are not allowed to use JavaScript macros.`);
    } else {
        const pack = game.packs.get(packName)
        const documents = await pack.getDocuments({ name })

        if (documents.length) {
            const body = `(async () => {${documents[0].data.command}})()`;
            const fn = Function("actor", "item", "qs", "args", body);
            try {
                args.result = result
                await fn.call(this, actor, item, qs, args);
            } catch (err) {
                ui.notifications.error(`There was an error in your macro syntax. See the console (F12) for details`);
                console.error(err);
                result.error = true
            }
        }
    }
    return result
}

export default class DSAActiveEffectConfig extends ActiveEffectConfig {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            resizable: true
        })
    }

    static async onEffectRemove(actor, effect) {
        const onRemoveMacro = getProperty(effect, "data.flags.dsa5.onRemove")
        if (onRemoveMacro) {
            if (!game.user.can("MACRO_SCRIPT")) {
                ui.notifications.warn(`You are not allowed to use JavaScript macros.`);
            } else {
                await eval(`(async () => {${onRemoveMacro}})()`)
            }
        }
    }

    async _render(force = false, options = {}) {
        await super._render(force, options);
        let index = -1
        const advancedFunctions = ["none", "systemEffect", "macro", "creature"].map(x => { return { name: `ActiveEffects.advancedFunctions.${x}`, index: index += 1 } })
        const itemType = getProperty(this.object, "parent.type")
        const effectConfigs = {
            hasSpellEffects: ["spell", "liturgy", "ritual", "ceremony", "consumable", "poison", "disease", "ammunition", "meleeweapon", "rangeweapon"].includes(itemType) || ((["specialability"].includes(itemType) && getProperty(this.object, "parent.data.data.category.value") == "Combat")),
            hasDamageTransformation: ["ammunition"].includes(itemType)
        }
        if (effectConfigs.hasDamageTransformation) {
            advancedFunctions.push({ name: 'ActiveEffects.advancedFunctions.armorPostprocess', index: 4 }, { name: 'ActiveEffects.advancedFunctions.damagePostprocess', index: 5 })
        }
        const config = {
            systemEffects: this.getStatusEffects(),
            canEditMacros: game.user.isGM || await game.settings.get("dsa5", "playerCanEditSpellMacro")
        }
        let elem = $(this._element)
        elem.find(".tabs").append(`<a class="item" data-tab="advanced"><i class="fas fa-shield-alt"></i>${game.i18n.localize("advanced")}</a>`)
        let template = await renderTemplate('systems/dsa5/templates/status/advanced_effect.html', { effect: this.object.data, advancedFunctions, effectConfigs, config })
        elem.find('.tab[data-tab="effects"]').after($(template))

        elem.find('.advancedSelector').change(ev => {
            let effect = this.object.data
            effect.flags.dsa5.advancedFunction = $(ev.currentTarget).val()

            renderTemplate('systems/dsa5/templates/status/advanced_functions.html', { effect, config }).then(template => {
                elem.find('.advancedFunctions').html(template)
            })
        })
    }

    async _onSubmit(event, { updateData = null, preventClose = false, preventRender = false } = {}) {
        const inActor = getProperty(this.object, "data.document.parent.documentName") != "Actor" && getProperty(this.object, "data.document.parent.parent")
        if (inActor) ui.notifications.error(game.i18n.localize("DSAError.nestedEffectNotSupported"))
        return await super._onSubmit(event, { updateData, preventClose, preventRender })
    }

    getStatusEffects() {
        return duplicate(CONFIG.statusEffects).map(x => { return { id: x.id, label: game.i18n.localize(x.label) } })
    }

    getData(options) {
        const data = super.getData(options);
        return data
    }

    static applyRollTransformation(actor, options, functionID) {
        let msg = ""
        let source = options.origin
        for (const ef of source.effects) {
            try {
                if (Number(getProperty(ef, "flags.dsa5.advancedFunction")) == functionID) {
                    eval(getProperty(ef, "flags.dsa5.args3"))
                }
            } catch (exception) {
                console.warn("Unable to apply advanced effect", exception, ef)
            }
        }
        options.origin = source
        return { msg, options }
    }

    static async applyAdvancedFunction(actor, effects, source, testData) {
        let msg = ""
        for (const ef of effects) {
            try {
                const customEf = Number(getProperty(ef, "flags.dsa5.advancedFunction"))
                const qs = Math.min(testData.qualityStep, 6)
                switch (customEf) {
                    case 1: //Systemeffekt
                        {
                            const effect = duplicate(CONFIG.statusEffects.find(e => e.id == getProperty(ef, "flags.dsa5.args0")))
                            let value = `${getProperty(ef, "flags.dsa5.args1")}`
                            effect.duration = ef.duration
                            if (/,/.test(value)) {
                                value = Number(value.split(",")[qs - 1])
                            } else {
                                value = Number(value.replace(game.i18n.localize('CHARAbbrev.QS'), qs))
                            }
                            await actor.addCondition(effect, value, false, false)
                        }
                        break
                    case 2: //Macro
                        if (!game.user.can("MACRO_SCRIPT")) {
                            ui.notifications.warn(`You are not allowed to use JavaScript macros.`);
                        } else {
                            await eval(`(async () => {${getProperty(ef, "flags.dsa5.args3")}})()`)
                        }
                        break
                    case 3: // Creature Link
                        let creatures = (getProperty(ef, "flags.dsa5.args4") || "").split(",").map(x => `@Compendium[${x.trim().replace(/(@Compendium\[|\])/)}]`).join(" ")
                        msg += `<p><b>${game.i18n.localize('ActiveEffects.advancedFunctions.creature')}</b>:</p><p>${creatures}</p>`
                        break
                }
            } catch (exception) {
                console.warn("Unable to apply advanced effect")
                console.warn(exception)
                console.warn(ef)
            }
        }
        return msg
    }

    dropDownMenu() {
        const FW = game.i18n.localize("MODS.FW")
        const skill = game.i18n.localize('skill')
        const FP = game.i18n.localize("MODS.FP")
        const stepValue = game.i18n.localize("stepValue")
        const QS = game.i18n.localize("MODS.QS")
        const partChecks = game.i18n.localize("MODS.partChecks")

        let optns = [
            { name: game.i18n.localize('protection'), val: "data.totalArmor" },
            { name: game.i18n.localize('carrycapacity'), val: "data.carryModifier" },
            { name: `${game.i18n.localize('closeCombatAttacks')} - ${game.i18n.localize('CHARAbbrev.AT')}`, val: "data.meleeStats.attack" },
            { name: `${game.i18n.localize('closeCombatAttacks')} - ${game.i18n.localize('CHARAbbrev.PA')}`, val: "data.meleeStats.parry" },
            { name: `${game.i18n.localize('closeCombatAttacks')} - ${game.i18n.localize('CHARAbbrev.damage')}`, val: "data.meleeStats.damage" },
            { name: `${game.i18n.localize('closeCombatAttacks')} - ${game.i18n.localize('MODS.defenseMalus')}`, val: "data.meleeStats.defenseMalus" },
            { name: `${game.i18n.localize('rangeCombatAttacks')} - ${game.i18n.localize('CHARAbbrev.AT')}`, val: "data.rangeStats.attack" },
            { name: `${game.i18n.localize('rangeCombatAttacks')} - ${game.i18n.localize('CHARAbbrev.damage')}`, val: "data.rangeStats.damage" },
            { name: `${game.i18n.localize('rangeCombatAttacks')} - ${game.i18n.localize('MODS.defenseMalus')}`, val: "data.rangeStats.defenseMalus" },
            { name: `${game.i18n.localize('spell')} - ${game.i18n.localize('CHARAbbrev.damage')}`, val: "data.spellStats.damage" },
            { name: `${game.i18n.localize('liturgy')} - ${game.i18n.localize('CHARAbbrev.damage')}`, val: "data.liturgyStats.damage" },
            { name: game.i18n.localize('KaPCost'), val: "data.kapModifier" },
            { name: game.i18n.localize('AsPCost'), val: "data.aspModifier" },
            { name: `${skill} - ${FW}`, val: "data.skillModifiers.FW" },
            { name: `${skill} - ${FP}`, val: "data.skillModifiers.FP" },
            { name: `${skill} - ${stepValue}`, val: "data.skillModifiers.step" },
            { name: `${skill} - ${QS}`, val: "data.skillModifiers.QL" },
            { name: `${skill} - ${partChecks}`, val: "data.skillModifiers.TPM" },
            { name: `${skill} - ${game.i18n.localize("MODS.global")}`, val: "data.skillModifiers.global" },
            { name: `${game.i18n.localize('regenerate')} (${game.i18n.localize("CHARAbbrev.CR")}) - ${game.i18n.localize("wounds")}`, val: "data.repeatingEffects.startOfRound.wounds" },
            { name: `${game.i18n.localize('regenerate')} (${game.i18n.localize("CHARAbbrev.CR")}) - ${game.i18n.localize("astralenergy")}`, val: "data.repeatingEffects.startOfRound.astralenergy" },
            { name: `${game.i18n.localize('regenerate')} (${game.i18n.localize("CHARAbbrev.CR")}) - ${game.i18n.localize("karmaenergy")}`, val: "data.repeatingEffects.startOfRound.karmaenergy" }
        ]
        const models = ["liturgy", "ceremony", "spell", "ritual", "skill", "feature"]
        for (const k of models) {
            let key = k == "skill" ? "skillglobal" : k
            const el = game.i18n.localize(key)
            optns.push({ name: `${el} - ${FW}`, val: `data.skillModifiers.${k}.FW` },

                { name: `${el} - ${FP}`, val: `data.skillModifiers.${k}.FP` },

                { name: `${el} - ${stepValue}`, val: `data.skillModifiers.${k}.step` },

                { name: `${el} - ${QS}`, val: `data.skillModifiers.${k}.QL` },

                { name: `${el} - ${partChecks}`, val: `data.skillModifiers.${k}.TPM` })
        }

        const attrs = ["mu", "kl", "in", "ch", "ff", "ge", "ko", "kk"]
        for (const k of attrs)
            optns.push({ name: game.i18n.localize(`CHAR.${k.toUpperCase()}`), val: `data.characteristics.${k}.gearmodifier` })

        for (const k of DSA5.gearModifyableCalculatedAttributes)
            optns.push({ name: game.i18n.localize(k), val: `data.status.${k}.gearmodifier` })

        optns = optns.sort((a, b) => { return a.name.localeCompare(b.name) })
        optns = optns.map(x => { return `<option value="${x.val}">${x.name}</option>` }).join("\n")
        return `<select class="selMenu">${optns}</select>`
    }

    activateListeners(html) {
        super.activateListeners(html)
        const dropDown = this.dropDownMenu()
        html.find('.changes-list .effect-change .key').append(dropDown)
        html.find('.selMenu').change(ev => {
            const elem = $(ev.currentTarget)
            elem.siblings('input').val(elem.val())
            elem.blur()
        })
    }
}