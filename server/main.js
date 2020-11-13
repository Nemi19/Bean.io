const uWebSockets = require("uWebSockets.js");

const server = new uWebSockets.App({});

const tickRate = 1000 / 40;
const mapSize = 1000;
const tileSize = 100;
const invertedMapSize = 1 / mapSize;
const halfMapSize = mapSize * 0.5;

let nameMessage = new Uint8Array([0x02]);
const bodyData = new Uint8Array(7);

const availableIDs = Array.from({ length: 65536 }, (v, i) => 65535 - i);

const looseCells = [];
const tightCells = [];
const looseSize = ~~(mapSize / 100);
const tightSize = ~~(mapSize / 100);
const looseScale = invertedMapSize * looseSize;
const tightScale = invertedMapSize * tightSize;
let queryCount = 0;
const queryArray = [];

for (let i = 0; i < looseSize * looseSize; i++) {
	looseCells.push({
		aabb: [0, 0, 0, 0],
		entities: []
	});
}

for (let i = 0; i < tightSize * tightSize; i++)
	tightCells.push([]);

const insertLooseCell = (entity) => {
	const xIndex = ~~((entity.x * invertedMapSize) * looseSize);
	const yIndex = ~~((entity.y * invertedMapSize) * looseSize);
	const index = xIndex + yIndex * looseSize;
	looseCells[index].entities.push(entity);
	entity.cellIndex = index;
};

const assignLooseCells = () => {
	for (let i = 0; i < tightCells.length; i++)
		tightCells[i].length = 0;
	for (let i = 0; i < looseCells.length; i++) {
		const firstX = Math.max(0, Math.min(~~(looseCells[i].aabb[0] * tightScale), tightSize - 1));
		const lastX = Math.max(0, Math.min(~~(looseCells[i].aabb[1] * tightScale), tightSize - 1));
		const firstY = Math.max(0, Math.min(~~(looseCells[i].aabb[2] * tightScale), tightSize - 1));
		const lastY = Math.max(0, Math.min(~~(looseCells[i].aabb[3] * tightScale), tightSize - 1));

		for (let y = firstY; y <= lastY; y++) {
			const yIndex = y * tightSize;
			for (let x = firstX; x <= lastX; x++)
				tightCells[x + yIndex].push(looseCells[i]);
		}
	}
};

const queryRegion = (l, r, t, b) => {
	const firstX = Math.max(0, Math.min(~~(l * tightScale), tightSize - 1));
	const lastX = Math.max(0, Math.min(~~(r * tightScale), tightSize - 1));
	const firstY = Math.max(0, Math.min(~~(t * tightScale), tightSize - 1));
	const lastY = Math.max(0, Math.min(~~(b * tightScale), tightSize - 1));
	
	const looseCellIndices = [];
	queryCount = 0;
	for (let y = firstY; y <= lastY; y++) {
		const yIndex = y * tightSize;
		for (let x = firstX; x <= lastX; x++) {
			const tightCell = tightCells[x + yIndex];
			for (let i = 0, li = tightCell.length; i < li; i++) {
				const looseCell = tightCell[i];
				if (!looseCellIndices.includes(looseCell)) {
					looseCellIndices.push(looseCell);
					for (let j = 0, lj = looseCell.entities.length; j < lj; j++) {
						const entity = looseCell.entities[j];
						if (entity.x - entity.radius < r && entity.x + entity.radius > l && entity.y - entity.radius < b && entity.y + entity.radius > t) {
							queryArray[queryCount] = entity;
							queryCount++;
						} 
					}
				}
			}
		}	
	}
};

const bodies = [];
const connections = [];
const targets = [];

const bodyMap = {};
const connectionMap = {};
const targetMap = {};

const createComponent = (id, component, array, map) => {
	component.id = id;
	map[id] = array.length;
	array.push(component);
};

const deleteComponent = (id, array, map) => {
	const index = map[id];
	delete map[id];
	if (index === array.length - 1)
		array.pop();
	else {
		map[array[array.length - 1].id] = index;
		array[index] = array.pop();
	}
};

const createArchetypePlayer = (body, connection) => {
	const id = availableIDs.pop();
	createComponent(id, body, bodies, bodyMap); insertLooseCell(body);
	createComponent(id, connection, connections, connectionMap);
	return id;
};

const createArchetypeBot = (body, target) => {
	const id = availableIDs.pop();
	createComponent(id, body, bodies, bodyMap); insertLooseCell(body);
	createComponent(id, target, targets, targetMap);
	return id;
};

const deleteArchetypePlayer = (id) => {
	const body = bodies[bodyMap[id]];
	const cell = looseCells[body.cellIndex];
	cell.entities.splice(cell.entities.indexOf(body), 1);
	deleteComponent(id, bodies, bodyMap);
	deleteComponent(id, connections, connectionMap);

	for (let i = 0; i < targets.length; i++) {
		if (targets[i].target === id)
			target = undefined;
	}

	for (let i = 1; i < nameMessage.length; i += 32) {
		const nameID = (nameMessage[i] << 8) | nameMessage[i + 1];
		if (id === nameID) {
			const temp = Array.from(nameMessage);
			temp.splice(i, 32);
			nameMessage = new Uint8Array(temp);
			break;
		}
	}

	availableIDs.push(id);
};

const deleteArchetypeBot = (id) => {
	const body = bodies[bodyMap[id]];
	const cell = looseCells[body.cellIndex];
	cell.entities.splice(cell.entities.indexOf(body), 1);
	deleteComponent(id, bodies, bodyMap);
	deleteComponent(id, targets, targetMap);
	availableIDs.push(id);
};

const random = (min, max) => {
	return Math.random() * (max - min) + min;
};

const update = () => {
	for (let i = 0; i < connections.length; i++) {
		const player = connections[i];
		const body = bodies[bodyMap[player.id]];

		let ax = 0;
		let ay = 0;
		if (player.inputKeys & 0x01) ay -= 1;
		if (player.inputKeys & 0x02) ax -= 1;
		if (player.inputKeys & 0x04) ay += 1;
		if (player.inputKeys & 0x08) ax += 1;

		const len = Math.hypot(ax, ay);
		if (len !== 0) {
			body.vx += ax / len;
			body.vy += ay / len;
		}
	}

	for (let i = 0; i < targets.length; i++) {
		if (targets[i].target === undefined || targets[i].target === targets[i].id)
			targets[i].target = ~~(Math.random() * bodies.length);
		else {
			const body = bodies[targets[i].id];
			const target = bodies[targets[i].target];

			let dx = target.x - body.x;
			let dy = target.y - body.y;
			const len = Math.hypot(dx, dy);
			if (len !== 0) {
				body.vx += dx / len;
				body.vy += dy / len;
			}
		}
	}

	for (let i = 0; i < looseCells.length; i++) {
		looseCells[i].aabb[0] = mapSize;
		looseCells[i].aabb[1] = 0;
		looseCells[i].aabb[2] = mapSize;
		looseCells[i].aabb[3] = 0;
	}

	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i];
		queryRegion(body.x - body.radius, body.x + body.radius, body.y - body.radius, body.y + body.radius);
		for (let j = 0; j < queryCount; j++) {
			const other = queryArray[j];
			if (body.id < other.id) {
				let dx = body.x - other.x;
				let dy = body.y - other.y;
				const d = Math.abs(dx * dx + dy * dy);
				const r = body.radius + other.radius;
				
				if (d < r * r) {
					const len = Math.hypot(dx, dy);
					if (len === 0) {
						dx = Math.random() - 0.5;
						dy = Math.random() - 0.5;
					} else {
						dx /= len;
						dy /= len;
					}

					body.vx += dx;
					body.vy += dy;
					other.vx -= dx;
					other.vy -= dy;
				}
			}
		}

		body.x += body.vx;
		body.y += body.vy;
		body.vx *= 0.9;
		body.vy *= 0.9;

		if (body.x - body.radius <= 0) {
			body.vx *= -1;
			body.x += 0.1  - (body.x - body.radius);
		} else if (body.x + body.radius >= mapSize) {
			body.vx *= -1;
			body.x -= 0.1 + (body.x + body.radius) - mapSize;
		}

		if (body.y - body.radius <= 0) {
			body.vy *= -1;
			body.y += 0.1 - (body.y - body.radius);
		} else if (body.y + body.radius >= mapSize) {
			body.vy *= -1;
			body.y -= 0.1 + (body.y + body.radius) - mapSize;
		}

		const xIndex = ~~(body.x * looseScale);
		const yIndex = ~~(body.y * looseScale);
		const index = xIndex + yIndex * looseSize;
		
		let cell = looseCells[body.cellIndex];

		if (index !== body.cellIndex) {
			const bodyIndex = cell.entities.indexOf(body);
			if (bodyIndex == cell.entities.length - 1)
				cell.entities.pop();
			else
				cell.entities[bodyIndex] = cell.entities.pop();

			insertLooseCell(body);
			cell = looseCells[body.cellIndex];
		}

		cell.aabb[0] = Math.min(cell.aabb[0], body.x - body.radius);
		cell.aabb[1] = Math.max(cell.aabb[1], body.x + body.radius);
		cell.aabb[2] = Math.min(cell.aabb[2], body.y - body.radius);
		cell.aabb[3] = Math.max(cell.aabb[3], body.y + body.radius);
	}

	assignLooseCells();

	for (let i = 0; i < connections.length; i++) {
		const player = connections[i];
		if (player.ws.getBufferedAmount() < 1024) {
			const playerBody = bodies[bodyMap[player.id]];
			queryRegion(playerBody.x - 600, playerBody.x + 600, playerBody.y - 600, playerBody.y + 600);
			const message = new Uint8Array(1 + queryCount * 7);
			message[0] = 0x04;
			for (let j = 0; j < queryCount; j++) {
				const body = queryArray[j];
				bodyData[0] = body.type;
				bodyData[1] = body.id >> 8;
				bodyData[2] = body.id;
				bodyData[3] = body.x >> 8;
				bodyData[4] = body.x;
				bodyData[5] = body.y >> 8;
				bodyData[6] = body.y;
				message.set(bodyData, 1 + (j * 7));
			}
			player.ws.send(message, true, false);
		}
	}

	queryRegion(halfMapSize - 500, halfMapSize + 500, halfMapSize - 400, halfMapSize + 400);
	const lobbyMessage = new Uint8Array(1 + queryCount * 7);
	lobbyMessage[0] = 0x05;
	for (let j = 0; j < queryCount; j++) {
		const body = queryArray[j];
		bodyData[0] = body.type;
		bodyData[1] = body.id >> 8;
		bodyData[2] = body.id;
		bodyData[3] = body.x >> 8;
		bodyData[4] = body.x;
		bodyData[5] = body.y >> 8;
		bodyData[6] = body.y;
		lobbyMessage.set(bodyData, 1 + (j * 7));
	}
	server.publish("lobby", lobbyMessage, true, false);
};

server.ws("/*", {
	// idleTimeout: 30,
	maxPayloadLength: 32,
	compression: uWebSockets.DISABLED,

	open: (ws) => {
		console.log("someone connected", String.fromCharCode(...new Uint8Array(ws.getRemoteAddressAsText())));

		ws.send(nameMessage, true, false);
		ws.subscribe("name");
		ws.subscribe("lobby");
	},
	message: (ws, message, isBinary) => {
		const data = new Uint8Array(message);
		switch (data[0]) {
			case 0x00:
				if (ws.id !== undefined) {
					ws.close();
					break;
				}
				const radius = 40;
				const x = random(radius, mapSize - radius);
				const y = random(radius, mapSize - radius);

				const body = {
					x: x,
					y: y,
					vx: 0,
					vy: 0,
					radius: radius,
					type: 0
				};
				const connection = {
					ws: ws,
					inputKeys: 0
				};
				ws.id = createArchetypePlayer(body, connection);

				const temp = new Uint8Array(nameMessage.length + 32);
				temp.set(nameMessage);
				temp.set([ws.id >> 8, ws.id, ...data.subarray(1)], nameMessage.length);
				nameMessage = temp;

				server.publish("name", new Uint8Array([0x03, ...temp.subarray(nameMessage.length - 32)]), true, false);

				ws.send(new Uint8Array([0x01, ws.id >> 8, ws.id]), true, false);
				ws.unsubscribe("lobby");
				break;
			case 0x01:
				if (connectionMap.hasOwnProperty(ws.id)) {
					connections[connectionMap[ws.id]].inputKeys = data[1];
					// TODO: player rotation
				} else
					ws.close();
				break;
		}
	},
	close: (ws, code, message) => {
		if (ws.id)
			deleteArchetypePlayer(ws.id);
	}
}).listen(9001, (listenSocket) => {
	if (listenSocket) {
		console.log("Listening on port 9001");

		for (let i = 0; i < 100; i++) {
			const radius = 30;
			const x = random(radius, mapSize - radius);
			const y = random(radius, mapSize - radius);
			const body = {
				x: x,
				y: y,
				vx: random(-1, 1),
				vy: random(-1, 1),
				radius: radius,
				type: 1
			};
			const target = {
				target: ~~(Math.random() * bodies.length)
			};
			createArchetypeBot(body, target);
		}
		setInterval(update, tickRate);
	}
});