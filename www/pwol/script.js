'use strict';

const {error} = console; // const log = function () {}; // = console.log;
const devices = [];
const api_ep = "/cgi-bin/pwol-ctl";
const srr = "/luci-static/resources/"; // static resources root dir
Object.defineProperties(Date, { now_sec: { enumerable: true, get() { return (Date.now()/1000) >>> 0; }, } });

class NwkDevice {

	static status_icon_path = {
		renewing:       srr+"icons/loading.gif",
		online:	 srr+"cbi/save.gif",
		waking:	 srr+"cbi/apply.gif",
		offline:	srr+"cbi/reset.gif",
		error:	  srr+"cbi/help.gif",
		connected:      srr+"icons/port_up.png",
		disconnected: srr+"icons/port_down.png",
	};
	static auto_update = {
		default: { interval_sec: 10 },
		quick: { interval_sec: 3, duration_max_sec: 60, },
	};

	name = "";
	info = { ip: "", mac: "", };
	auto_update = { en: false, qmode: false, timeout_ts: 0 };
	h_intv = null;
	root_tbl = { elem: null, row_idx: NaN, };
	elem = { tr: null, sts: null, chk: null, wake: null, };
	state_prev;

	constructor(root_tbl_elem, name, info, auto_update_en = false) {
		this.name = name;
		Object.assign(this.info, info);
		this.root_tbl.elem = root_tbl_elem;
		this.root_tbl.row_idx = root_tbl_elem.rows.length;
		this.elem_create();
		this.chk_sts();
		if (auto_update_en) { this.auto_update.en = true; this.update_interval = this.constructor.auto_update.default.interval_sec; };
	};

	set update_interval(val) {
		if (this.h_intv) { clearInterval(this.h_intv); this.h_intv = null; };
		if (!(val > 1)) { return; };
		this.h_intv = setInterval(this.chk_sts.bind(this), val*1000);
	};
	get state() { return this.elem.sts.alt; };
	set state(sts) {
		// log("Dev['%s']: setting state '%s'", this.name, sts);
		this.elem.chk.disabled = this.elem.wake.disabled = (sts === 'renewing');
		const src = this.constructor.status_icon_path[sts];
		if (!src) { error("Dev['%s']: Could not set state '%s': invalid value!", this.name, sts); return; };
		if (!this.elem.chk.disabled) { this.state_prev = this.state; };
		Object.assign(this.elem.sts, { src, alt: sts, title: sts, })
	};

	elem_create() {
		let td,el;
		const tr = this.elem.tr = this.root_tbl.elem.insertRow();
		td = tr.insertCell(); Object.assign(td, { innerText: this.name, style: "text-transform: uppercase;" });
		td = tr.insertCell(); Object.assign(td, { innerText: this.info.mac });
		td = tr.insertCell(); Object.assign(td, { innerText: this.info.ip });

		td = tr.insertCell(); // Object.assign(td, { innerHTML: '<img src="/luci-static/resources/icons/loading.gif" height="16px"><img src="/luci-static/resources/cbi/save.gif" height="16px"><img src="/luci-static/resources/cbi/reset.gif" height="16px">' });
		el = this.elem.sts = document.createElement('img'); Object.assign(el, { src: this.constructor.status_icon_path.renewing, height: 16 });
		td.appendChild(el);

		td = tr.insertCell(); // Object.assign(td, { innerHTML:  });
		el = this.elem.wake = document.createElement('button'); Object.assign(el, { innerText: "Wake", disabled: false }); el.addEventListener('click', this.wake.bind(this));
		td.appendChild(el);
		if (!this.auto_update.en) {
			el = this.elem.chk = document.createElement('button'); Object.assign(el, { innerText: "Check", disabled: false }); el.addEventListener('click', this.chk_sts.bind(this));
			td.appendChild(el);
		};
	};
	wake(evt) {
		// log("Dev['%s'].wake button clicked", this.name);
		if (this.elem.wake.disabled) { error("Cannot invoke waking until current operation is finished."); return; };
		this.state = 'renewing';
		api_get({ cmd: "hw", host: this.name }).then((resp) => {
			do {
				if (!resp?.ok) { error("Dev['%s']: Received fail-resp:", this.name, resp); break; };
				if (!resp.data[this.name]?.hasOwnProperty('wol_ok')) { error("Dev['%s']: invalid resp structure:", this.name, resp); break; };
				if (!resp.data[this.name].wol_ok) { error("Dev['%s']: failed sending WOL!", this.name); break; };
				this.state = 'waking';
				this.auto_update.qmode = true;
				this.auto_update.timeout_ts = Date.now_sec + this.constructor.auto_update.quick.duration_max_sec;
				this.update_interval = this.constructor.auto_update.quick.interval_sec;
				return;
			} while (0);
			this.state = 'error';
		}).catch((err) => {
			error("Dev['%s']: Failed receiving status update:", this.name, err);
			this.state = 'error';
		});

	};
	chk_sts(evt) {
		//log("Dev['%s'].chk_sts button clicked", this.name);
		if (this.elem.chk.disabled) { error("Cannot initiate new state check until current operation is finished."); return; };
		this.state = 'renewing';
		const au = this.auto_update;
		if (au.qmode) {
			const now = Date.now_sec;
			if (au.timeout_ts < now) {
				au.qmode = false; this.update_interval = (au.en)?(this.constructor.auto_update.default.interval_sec):(0);
				this.state = 'error';
				this.elem.sts.title = "The host did not wake up within expected time, manual check required.";
				return;
			};
		};
		api_get({ cmd: "hs", host: this.name }).then((resp) => {
			do {
				if (!resp?.ok) { error("Dev['%s']: Received fail-resp:", this.name, resp); break; };
				if (!resp.data[this.name]?.hasOwnProperty('online')) { error("Dev['%s']: invalid resp structure:", this.name, resp); };
				if (resp.data[this.name].online) {
					this.state = 'online';
					if (au.qmode) { au.qmode = false; this.update_interval = (au.en)?(this.constructor.auto_update.default.interval_sec):(0); };
				} else {
					this.state = 'offline';
				};
				return;
			} while (0);
			this.state = 'error';
		}).catch((err) => {
			error("Dev['%s']: Failed receiving status update:", this.name, err);
			this.state = 'error';
		});
	};
};

function api_get(req) { const q = new URLSearchParams(req); return fetch(api_ep + '?' + q).then(data => data.json()); };
function show_error(msg, err) {
	const el = document.getElementById('err_cont');
	Object.assign(el, { innerText: msg, hidden: false, })
};
function create_dev_table(resp) {
	// log("resp:", resp);
	const root_elem =  document.getElementById("dev_list");
	if (!resp?.ok || !resp.data) { show_error("Invalid device list received:", resp); return; };
	function dev_val(dev) { return Number(resp.data[dev].ip.split('.')[3]); };
	const devs_sorted = Object.keys(resp.data).sort((a, b) => (dev_val(a)-dev_val(b)));
	for (const dev of devs_sorted) { devices.push(new NwkDevice(root_elem, dev, resp.data[dev])); };
};

window.addEventListener('DOMContentLoaded', function main(evt) {
	api_get({ cmd: "hl" }).then(create_dev_table).catch(show_error.bind(this, "ERROR: Failed to read states of devices"));
});
