import { AssetInfo, isNativeAsset } from "../types/base/asset";
import { Path } from "../types/base/path";
import { Pool } from "../types/base/pool";

export interface Graph {
	vertices: Map<string, Vertex>;
}

type Vertex = {
	name: string;
	edges: Array<Edge>;
};

type Edge = {
	from: Vertex;
	to: Vertex;
	pools: Array<Pool>;
};

// **************************************** GRAPH **************************************** \\

/**
 *
 */
export function newGraph(pools: Array<Pool>): Graph {
	const vertices = new Map();
	const graph: Graph = { vertices: vertices };
	for (const pool of pools) {
		const vertexA: Vertex = getVertex(
			graph,
			isNativeAsset(pool.assets[0].info)
				? pool.assets[0].info.native_token.denom
				: pool.assets[0].info.token.contract_addr,
		);
		const vertexB: Vertex = getVertex(
			graph,
			isNativeAsset(pool.assets[1].info)
				? pool.assets[1].info.native_token.denom
				: pool.assets[1].info.token.contract_addr,
		);
		connectTo(vertexA, vertexB, pool);
		connectTo(vertexB, vertexA, pool);
	}
	return graph;
}
/**
 *
 */
function getVertex(graph: Graph, name: string): Vertex {
	const vertex = graph.vertices.get(name);
	if (vertex === undefined) {
		const addedVertex = newVertex(name);
		graph.vertices.set(name, addedVertex);
		return addedVertex;
	} else {
		return vertex;
	}
}
/**
 *
 */
export function getPaths(graph: Graph, startingAsset: AssetInfo, depth: number): Array<Path> | undefined {
	const startingAssetName = isNativeAsset(startingAsset)
		? startingAsset.native_token.denom
		: startingAsset.token.contract_addr;
	const root = graph.vertices.get(startingAssetName);
	if (!root) {
		console.log("graph does not contain starting asset");
		return undefined;
	}

	const edgeLists = depthFirstSearch(root, root.name, depth);

	const poolLists: Array<Array<Pool>> = [];
	for (const edgeList of edgeLists) {
		let newPoolLists: Array<Array<Pool>> = [];
		for (const edge of edgeList) {
			newPoolLists = expandEdge(edge, newPoolLists);
			if (newPoolLists.length === 0) {
				break;
			}
		}
		poolLists.push(...newPoolLists);
	}
	const paths: Array<Path> = [];

	let idx = 0;
	// create paths and sets identifier number starting at 0
	for (const poolList of poolLists) {
		if (poolList.length >= 2) {
			paths.push({
				pools: poolList,
				equalpaths: new Array<[string, number]>(),
				identifier: [getAddrfromPools(poolList), idx],
			});
			idx++;
		}
	}

	// ADDs similar Paths (path2) that should be timouted together with path (path), to path (path)
	// both paths need an intersection bigger than 1 and are not allowed to have equal pool at the same step of their path
	for (const path of paths) {
		const setarr = [...path.pools.map((pool) => pool.address)];
		for (const path2 of paths) {
			const intersection = path2.pools.filter((pool2) => setarr.find((address) => address === pool2.address));
			let sameIndexed = 0;
			for (const pool of intersection) {
				if (
					path.pools.findIndex((pathpool) => pathpool.address === pool.address) ===
						path2.pools.findIndex((pathpool) => pathpool.address === pool.address) ||
					path.pools[path.pools.length - 1].address === path2.pools[path2.pools.length - 1].address
				) {
					sameIndexed = sameIndexed + 1;
				}
			}
			//if at least 1 equal pool and half of them is on the same index?
			if (
				intersection.length > Math.floor(path.pools.length / 2) &&
				sameIndexed >= Math.floor(intersection.length / 2)
			) {
				path.equalpaths.push(path2.identifier);
			}
		}
	}
	return paths;
}

/**
 * Returns Set of Addresses in Pools.
 */
function getAddrfromPools(pools: Array<Pool>) {
	let out = "";
	for (let i = 0; i < pools.length; i++) {
		out = out + pools[i].address;
	}
	return out;
}

// *************************************** VERTEX **************************************** \\

/**
 *
 */
function newVertex(name: string): Vertex {
	const vertex: Vertex = { name: name, edges: [] };
	return vertex;
}

/**
 *
 */
function connectTo(vertex: Vertex, otherVertex: Vertex, pool: Pool) {
	for (const edge of vertex.edges) {
		if (edge.to.name == otherVertex.name) {
			addEdge(edge, pool);
			return;
		}
	}
	vertex.edges.push(newEdge(vertex, otherVertex, pool));
}
/**
 *
 */
function depthFirstSearch(vertex: Vertex, start: string, depth: number): Array<Array<Edge>> {
	const edgeLists: Array<Array<Edge>> = [];
	if (depth < 1) {
		return edgeLists;
	}
	for (const edge of vertex.edges) {
		// Base Case
		if (edge.to.name === start) {
			edgeLists.push([edge]);
		}
		// Recursive case
		if (depth > 1) {
			for (const edgeList of depthFirstSearch(edge.to, start, depth - 1)) {
				edgeList.push(edge);
				edgeLists.push(edgeList);
			}
		}
	}
	return edgeLists;
}

// **************************************** EDGES **************************************** \\
/**
 *
 */
function newEdge(from: Vertex, to: Vertex, pool: Pool): Edge {
	const edge: Edge = { from: from, to: to, pools: [pool] };
	return edge;
}
/**
 *
 */
function addEdge(edge: Edge, pool: Pool) {
	edge.pools.push(pool);
}

/**
 *
 */
function expandEdge(edge: Edge, oldLists: Array<Array<Pool>>): Array<Array<Pool>> {
	const newHopLists: Array<Array<Pool>> = [];
	if (oldLists.length === 0) {
		for (const pool of edge.pools) {
			newHopLists.push([pool]);
		}
	} else {
		for (const pool of edge.pools) {
			for (const oldList of oldLists) {
				if (!contained(oldList, pool)) {
					const newHopList: Array<Pool> = [pool];
					for (const oldPool of oldList) {
						newHopList.push(oldPool);
					}
					newHopLists.push(newHopList);
				}
			}
		}
	}
	return newHopLists;
}

/**
 *
 */
function contained(poollist: Array<Pool>, pool: Pool): boolean {
	return poollist.find((pooloflist) => pooloflist.address === pool.address) !== undefined;
}
