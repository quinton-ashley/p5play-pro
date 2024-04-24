/**
 * p5play-pro
 * @version 0.0
 * @author quinton-ashley
 * @license CC BY-NC-ND 4.0
 */
p5.prototype.registerMethod('init', function p5playProInit() {
	let $ = this;

	/* MULTIPLAYER */

	this.Netcode = class {
		/**
		 * EXPERIMENTAL! Work in progress, not ready for public use yet.
		 *
		 * A `netcode` object is created automatically when p5play loads.
		 *
		 * online multiplayer games and servers.
		 *
		 * "Netcode is a blanket term most commonly used by
		 * gamers relating to networking in online games, often referring to
		 * synchronization issues between clients and servers. Players often
		 * infer "bad netcodes" when they experience lag or when their inputs
		 * are dropped." - Wikipedia
		 */
		constructor() {
			this.typeSizes = {
				boolean: 1,
				Uint8: 1,
				Vec2_boolean: 1,
				Float16: 2,
				number: 2,
				color: 4,
				Float32: 4,
				Int32: 4,
				Vec2: 4,
				Float64: 8
			};
			this.player = 0;

			// source: https://stackoverflow.com/a/32633586/3792062
			this.encodeFloat16 = (function () {
				let fv = new Float32Array(1);
				let iv = new Int32Array(fv.buffer);
				return function toHalf(v) {
					fv[0] = v;
					let x = iv[0];
					let b = (x >> 16) & 0x8000;
					let m = (x >> 12) & 0x07ff;
					let e = (x >> 23) & 0xff;
					if (e < 103) return b;
					if (e > 142) {
						b |= 0x7c00;
						b |= (e == 255 ? 0 : 1) && x & 0x007fffff;
						return b;
					}
					if (e < 113) {
						m |= 0x0800;
						b |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
						return b;
					}
					b |= ((e - 112) << 10) | (m >> 1);
					b += m & 1;
					return b;
				};
			})();
		}

		// source: https://stackoverflow.com/a/8796597/3792062
		decodeFloat16(b) {
			let e = (b & 0x7c00) >> 10,
				f = b & 0x03ff;
			return (
				(b >> 15 ? -1 : 1) *
				(e ? (e === 0x1f ? (f ? NaN : Infinity) : Math.pow(2, e - 15) * (1 + f / 0x400)) : 6.103515625e-5 * (f / 0x400))
			);
		}

		connect() {}

		disconnect() {}

		/**
		 * Converts a sprite to a binary representation, which is smaller
		 * than serializing the data with JSON.stringify.
		 *
		 * This function is intended to be used to send sprite data over
		 * a network.
		 *
		 * @param {Sprite} sprite
		 * to binary. Defaults to all sprite properties.
		 */
		spriteToBinary(sprite) {
			const props = $.Sprite.props;

			// initial size is 2 bytes for sprite id and 1 for the ending byte
			let size = 3;
			// calculate size of buffer
			for (let i = 0; i < props.length; i++) {
				if (sprite.watch && !sprite.mod[i]) continue;
				const prop = props[i];
				const type = $.Sprite.propTypes[prop];

				let val = sprite[prop];
				if (val === undefined || val === null) continue;

				if (type == 'string') {
					const encoded = new TextEncoder().encode(val);
					size += encoded.length + 3;
				} else {
					size += this.typeSizes[type] + 1;
				}
			}
			if (size == 3) return null; // no data to send

			const buffer = new ArrayBuffer(size);
			const data = new DataView(buffer);
			data.setFloat16 = (o, v) => data.setUint16(o, this.encodeFloat16(v));

			data.setUint16(0, sprite._uid);

			let o = 2; // byte offset
			for (let i = 0; i < props.length; i++) {
				if (sprite.watch && !sprite.mod[i]) continue;
				const prop = props[i];
				const type = $.Sprite.propTypes[prop];

				let val = sprite[prop];
				if (val === undefined || val === null) continue;

				data.setUint8(o, i);
				o += 1;

				if (type == 'boolean') {
					data.setUint8(o, val ? 1 : 0);
				} else if (type == 'number' || type == 'Float16') {
					if (prop == 'rotation' && (val > 2048 || val < -2048)) {
						// half float integer precision is limited to -2048 to 2048
						val = val % 2048;
						sprite[prop] = val;
					}
					data.setFloat16(o, val);
				} else if (type == 'Float32') {
					data.setFloat32(o, val);
				} else if (type == 'Float64') {
					data.setFloat64(o, val);
				} else if (type == 'string') {
					const encoded = new TextEncoder().encode(val);
					data.setUint16(o, encoded.length);
					o += 2;
					for (let j = 0; j < encoded.length; j++) {
						data.setUint8(o, encoded[j]);
						o += 1;
					}
					continue;
				} else if (type == 'color') {
					data.setUint8(o, val.levels[0]); // r
					data.setUint8(o + 1, val.levels[1]); // g
					data.setUint8(o + 2, val.levels[2]); // b
					data.setUint8(o + 3, val.levels[3]); // a
				} else if (type == 'Vec2') {
					data.setFloat16(o, val.x);
					data.setFloat16(o + 2, val.y);
				} else if (type == 'Vec2_boolean') {
					data.setUint8(o, (val.x ? 1 : 0) | (val.y ? 2 : 0));
				} else if (type == 'Uint8') {
					if (prop == 'collider') {
						data.getUint8(o, sprite.__collider);
					} else if (prop == 'shape') {
						data.getUint8(o, sprite.__shape);
					} else {
						data.getUint8(o, val);
					}
				} else if (type == 'Int32') {
					data.setInt32(o, val);
				}
				o += this.typeSizes[type];
			}

			data.setUint8(o, 255);

			sprite.watch = true;
			sprite.mod = {};

			return new Uint8Array(buffer);
		}

		spriteToBlob(sprite) {
			const binary = this.spriteToBinary(sprite);
			return new Blob([binary]);
		}

		/**
		 * Converts binary data, assigning the values to an existing sprite,
		 * found using the sprite's uid, or creates a new sprite.
		 *
		 * @param {Uint8Array} binary - binary data
		 * @param {number} [offset] - byte offset
		 * @returns {Sprite} the sprite
		 */
		binaryToSprite(binary, offset) {
			let data;
			if (binary instanceof DataView) data = binary;
			else data = new DataView(binary.buffer);

			data.getFloat16 = (o) => this.decodeFloat16(data.getUint16(o));

			let o = offset || 0;

			let uid = data.getUint16(o);
			o += 2;
			let sprite = $.p5play.sprites[uid] || new $.Sprite();

			while (o !== data.byteLength) {
				const propId = data.getUint8(o);
				if (propId === 255) break;
				o += 1;

				const prop = $.Sprite.props[propId];
				const type = $.Sprite.propTypes[prop];

				if (type === 'boolean') {
					sprite[prop] = data.getUint8(o) !== 0;
				} else if (type == 'number' || type === 'Float16') {
					sprite[prop] = data.getFloat16(o);
				} else if (type === 'Float32') {
					sprite[prop] = data.getFloat32(o);
				} else if (type === 'Float64') {
					sprite[prop] = data.getFloat64(o);
				} else if (type === 'string') {
					const strLength = data.getUint16(o);
					o += 2;
					const strBytes = new Uint8Array(data.buffer, o, strLength);
					sprite[prop] = new TextDecoder().decode(strBytes);
					o += strLength;
					continue;
				} else if (type === 'color') {
					const r = data.getUint8(o);
					const g = data.getUint8(o + 1);
					const b = data.getUint8(o + 2);
					const a = data.getUint8(o + 3);
					sprite[prop] = color(r, g, b, a);
				} else if (type === 'Vec2') {
					const x = data.getFloat16(o);
					const y = data.getFloat16(o + 2);
					sprite[prop] = { x, y };
				} else if (type === 'Vec2_boolean') {
					const byte = data.getUint8(o);
					sprite[prop] = { x: (byte & 1) === 1, y: (byte & 2) === 2 };
				} else if (type === 'Uint8') {
					let val = data.getUint8(o);
					if (prop === 'collider') {
						sprite.collider = $.Sprite.colliderTypes[val];
					} else if (prop === 'shape') {
						sprite.shape = $.Sprite.shapeTypes[val];
					} else {
						sprite[prop] = val;
					}
				} else if (type === 'Int32') {
					sprite[prop] = data.getInt32(o);
				}
				o += this.typeSizes[type];
			}
			data.offset = o;

			return sprite;
		}

		async blobToSprite(blob, offset) {
			const arrayBuffer = await blob.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);
			return this.binaryToSprite(uint8Array, offset);
		}

		inputToJSON() {}
	};

	this.netcode = new this.Netcode();

	/* ADS */

	this.loadAds = (opt) => {
		opt ??= {};
		// iOS
		if (window.webkit) {
			webkit.messageHandlers.loadAds.postMessage(JSON.stringify(opt));
		}
	};

	this.showAd = (type) => {
		if (type) type = type.toLowerCase();
		type ??= 'interstitial';
		// iOS
		if (window.webkit) {
			confirm('p5play:' + type);
		}
	};
});
