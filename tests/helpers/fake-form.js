'use strict';

/*
 * A minimal stand-in for LuCI's `form` module: it records every map, section and option a raw tab declares
 * (title, description, placeholder, default, choices) and renders them as plain rows.
 * It must stay self-contained: Playwright serialises it with toString() and runs it in the page.
 */
function fakeForm(E) {
	class Option {
		constructor(cls, name, title) {
			Object.assign(this, { cls: cls.name, name: name, title: title, choices: [], dependencies: [] });
		}

		value(key, label) { this.choices.push([ key, label == null ? key : label ]); }
		depends() { this.dependencies.push(Array.from(arguments)); }
	}

	class Section {
		constructor(cls, type, title) {
			Object.assign(this, { cls: cls.name, type: type, title: title, options: [] });
		}

		option(cls, name, title) {
			let option = new Option(cls, name, title);

			this.options.push(option);
			return option;
		}
	}

	class Map {
		constructor(config, title, description) {
			Object.assign(this, { config: config, title: title, description: description, sections: [] });
			form.maps.push(this);
		}

		section(cls, type, title) {
			let section = new Section(cls, type, title);

			this.sections.push(section);
			return section;
		}

		renderOption(option) {
			return E('div', { class: 'cbi-value', 'data-name': option.name }, [
				E('label', { class: 'cbi-value-title' }, [ option.title ]),
				E('div', { class: 'cbi-value-field' }, [ E('input', { name: option.name, placeholder: option.placeholder, value: option.default }) ]),
				option.description ? E('div', { class: 'cbi-value-description' }, [ option.description ]) : null
			]);
		}

		renderSection(section) {
			return E('div', { class: 'cbi-section' }, [
				section.title ? E('h3', [ section.title ]) : null,
				section.description ? E('div', { class: 'cbi-section-descr' }, [ section.description ]) : null,
				E('div', { class: 'cbi-section-node' }, section.options.map(option => this.renderOption(option)))
			]);
		}

		render() {
			return Promise.resolve(E('div', { class: 'cbi-map' }, [
				E('h2', [ this.title ]),
				this.description ? E('div', { class: 'cbi-map-descr' }, [ this.description ]) : null
			].concat(this.sections.map(section => this.renderSection(section)))));
		}
	}

	const form = { maps: [], Map: Map };

	for (const name of [ 'Value', 'DynamicList', 'Flag', 'ListValue', 'DummyValue', 'GridSection', 'NamedSection' ])
		form[name] = { [name]: class {} }[name];

	return form;
}

module.exports = { fakeForm };
