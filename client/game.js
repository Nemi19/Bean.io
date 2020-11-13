(async (w, d) => {
	const connecting = d.getElementById("connecting");
	const mainMenu = d.getElementById("mainMenu");
	const fpsP = d.getElementById("fpsP");
	const pingP = d.getElementById("pingP");
	const nicknameInput = d.getElementById("nicknameInput");
	const canvas = d.getElementById("gameCanvas");
	const ctx = canvas.getContext("2d");
	
	const mapSize = 1000;
	const tileSize = 100;
	let userID = null;
	let keys = 0;

	const camera = {
		x: 0,
		y: 0
	};

	const entityTypes = [
		{
			radius: 40,
			color: "rgb(51, 204, 255)"
		},
		{
			radius: 30,
			color: "rgb(153, 255, 51)"
		}
	];
	const lerp = (a, b, t) => {
		return (1 - t) * a + t * b;
	};
	const lerpColor = (a, b, c) => {
		let d = "rgb(";
		a = a.match(/[0-9]+/g);
		b = b.match(/[0-9]+/g);

		d += Math.round(lerp(parseInt(a[0]), parseInt(b[0]), c)) + ", ";
		d += Math.round(lerp(parseInt(a[1]), parseInt(b[1]), c)) + ", ";
		return d + Math.round(lerp(parseInt(a[2]), parseInt(b[2]), c)) + ")";
	};

	const entityNames = {};
	const createNameImage = async (id, name) => {
		const tempCanvas = document.createElement("canvas");
		const tc = tempCanvas.getContext("2d");
		tc.lineJoin = "round";
		tc.textBaseline = "top";
		tc.font = "36px Arial";
		const dimensions = tc.measureText(name);
		tempCanvas.width = dimensions.actualBoundingBoxRight - dimensions.actualBoundingBoxLeft;
		tempCanvas.height = dimensions.actualBoundingBoxDescent - dimensions.actualBoundingBoxAscent;

		tc.lineWidth = 6;
		tc.lineJoin = "round";
		tc.textAlign = "center";
		tc.textBaseline = "top";
		tc.font = "30px Arial";
		tc.strokeStyle = "#000";
		tc.fillStyle = "#FFF";
		tc.strokeText(name, tempCanvas.width * 0.5, -dimensions.actualBoundingBoxAscent);
		tc.fillText(name, tempCanvas.width * 0.5, -dimensions.actualBoundingBoxAscent);
		
		entityNames[id] = await createImageBitmap(tempCanvas);
	};

	const entitySprites = [];
	for (let [key, value] of Object.entries(entityTypes)) {
		const tempCanvas = document.createElement("canvas");
		tempCanvas.width = tempCanvas.height = value.radius * 2;
		const tc = tempCanvas.getContext("2d");
		tc.lineWidth = 4;
		tc.fillStyle = value.color;
		tc.strokeStyle = lerpColor(value.color, "rgb(0, 0, 0)", 0.25);
		tc.beginPath();
		tc.arc(tempCanvas.width * 0.5, tempCanvas.width * 0.5, value.radius - (tc.lineWidth * 0.5), 0, Math.PI * 2);
		tc.fill();
		tc.stroke();
		entitySprites.push(await createImageBitmap(tempCanvas));
	}

	const entities = [];
	let entityMap = {};

	const decodeString = (string) => {
		let name = "";
		for (let j = 0; j < string.length; j += 2) {
			const charCode = (string[j] << 8) | string[j + 1];
			if (charCode !== 0x00)
				name += String.fromCharCode(charCode);
		}
		return name;
	};

	let socket;
	let pingsPassed = 0;
	const connect = () => {
		socket = new WebSocket("ws://localhost:9001");
		socket.binaryType = "arraybuffer";

		socket.addEventListener("open", (event) => {
			connecting.style.display = "none";
			mainMenu.style.display = "grid";
			nicknameInput.focus();
		});

		socket.addEventListener("message", async (event) => {
			const data = new Uint8Array(event.data);
			pingsPassed++;
			switch(data[0]) {
				case 0x00:
					console.log("leaderboard");
					break;
				case 0x01:
					mainMenu.style.display = "none";
					userID = (data[1] << 8) | data[2];
					break;
				case 0x02:
					const namesData = data.subarray(1);
					for (let i = 0; i < namesData.length; i += 32) {
						const id = (namesData[i] << 8) | namesData[i + 1];
						const name = decodeString(namesData.subarray(i + 2, i + 32));
						createNameImage(id, name);
					}
					break;
				case 0x03:
					const id = (data[1] << 8) | data[2];
					const name = decodeString(data.subarray(3));
					createNameImage(id, name);
					break;
				case 0x04:
					if (userID !== null)
						socket.send(new Uint8Array([0x01, keys]));
				case 0x05:
					for (let i = 0; i < entities.length; i++) {
						if (entities[i].remove) {
							delete entityMap[entities[i].id];
							if (i === entities.length - 1)
								entities.pop();
							else {
								entityMap[entities[entities.length - 1].id] = i;
								entities[i] = entities.pop();
							}
						} else
							entities[i].remove = true;
					}

					entityData = data.subarray(1);
					for (let i = 0; i < entityData.length; i += 7) {
						const type = entityData[i];
						const id = (entityData[i + 1] << 8) | entityData[i + 2];
						const x = (entityData[i + 3] << 8) | entityData[i + 4];
						const y = (entityData[i + 5] << 8) | entityData[i + 6];
						if (entityMap.hasOwnProperty(id)) {
							const entity = entities[entityMap[id]];
							entity.x = x;
							entity.y = y;
							entity.remove = false;
						} else {
							entityMap[id] = entities.length;
							entities.push({
								id: id,
								x: x,
								y: y,
								px: x,
								py: y,
								type: type,
								remove: false
							});
						}
					}
					break;
			}
		});

		socket.addEventListener("close", (event) => {
			names = {};
			entityMap = {};
			entities.length = 0;
			keys = 0;
			camera.x = 0;
			camera.y = 0;
			userID = null;
			mainMenu.style.display = "none";
			connecting.style.display = "block";
			setTimeout(() => {
				connect();
			}, 2000);
		});
	};

	let msPrevious = 0;
	let timeElapsed = 0;
	let framesPassed = 0;
	const draw = () => {
		let time = Date.now();
		timeElapsed = Math.min(time - msPrevious, 100);
		msPrevious = time;

		timeElapsed *= 0.01;

		if (entityMap.hasOwnProperty(userID)) {
			camera.x = lerp(camera.x, entities[entityMap[userID]].px, timeElapsed);
			camera.y = lerp(camera.y, entities[entityMap[userID]].py, timeElapsed);
		} else {
			camera.x = mapSize * 0.5;
			camera.y = mapSize * 0.5;
		}
		
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		canvas.width = w.innerWidth;
		canvas.height = w.innerHeight;

		const s = Math.max(canvas.width / 2560, canvas.height / 1440);
		ctx.setTransform(s, 0, 0, s, canvas.width * 0.5, canvas.height * 0.5);
		ctx.translate(-camera.x, -camera.y);

		ctx.fillStyle = "#8c6";
		ctx.fillRect(0, 0, mapSize, mapSize);

		ctx.lineWidth = 2;
		ctx.strokeStyle = "rgb(255, 0, 0)";
		for (let x = 0; x <= mapSize; x += tileSize) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, mapSize);
			ctx.stroke();
		}
		for (let y = 0; y <= mapSize; y += tileSize) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(mapSize, y);
			ctx.stroke();
		}

		for (let i = 0; i < entities.length; i++) {
			const entity = entities[i];
			entity.px = lerp(entity.px, entity.x, timeElapsed * 1.5);
			entity.py = lerp(entity.py, entity.y, timeElapsed * 1.5);
			const image = entitySprites[entity.type];
			ctx.drawImage(image, entity.px - (image.width * 0.5) , entity.py - (image.width * 0.5));
		}
		
		for (let i = 0; i < entities.length; i++) {
			const entity = entities[i];
			if (entityNames.hasOwnProperty(entity.id)) {
				const image = entityNames[entity.id];
				ctx.drawImage(image, entity.px - (image.width * 0.5), entity.py - (image.height * 2.5));
			}
		}
		framesPassed++;

		w.requestAnimationFrame(draw);
	};

	w.setInterval(() => {
		fpsP.textContent = `fps: ${framesPassed}`;
		pingP.textContent = `ping: ${pingsPassed === 0 ? 0 : (1000 / pingsPassed).toFixed(0)}ms`;
		framesPassed = 0;
		pingsPassed = 0;
	}, 1000);

	w.addEventListener("keydown", (e) => {
		switch (e.keyCode) {
			case 87: case 38: keys |= 0x01; break;
			case 65: case 37: keys |= 0x02; break;
			case 83: case 40: keys |= 0x04; break;
			case 68: case 39: keys |= 0x08; break;
		}
	});
	w.addEventListener("keyup", (e) => {
		switch (e.keyCode) {
			case 87: case 38: keys ^= 0x01; break;
			case 65: case 37: keys ^= 0x02; break;
			case 83: case 40: keys ^= 0x04; break;
			case 68: case 39: keys ^= 0x08; break;
		}
	});
	w.addEventListener("blur", (e) => {
		keys = 0;
	});

	nicknameInput.addEventListener("keydown", (e) => {
		nicknameInput.value = nicknameInput.value.substring(0, 15);

		if (e.keyCode === 13 && socket.readyState === WebSocket.OPEN) {
			const utf8Name = new Uint8Array(30);
			for (let i = 0; i < nicknameInput.value.length; i++) {
				const bytes = nicknameInput.value.charCodeAt(i);
				utf8Name[(i * 2)] = bytes >> 8;
				utf8Name[(1 + (i * 2))] = bytes & 0xFF; 
			}

			const message = new Uint8Array([0x00, ...utf8Name]);
			socket.send(message);
			nicknameInput.blur();
		}
	});

	draw();
	connect();
})(window, document);