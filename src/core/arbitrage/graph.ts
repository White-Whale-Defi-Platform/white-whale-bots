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
	// create paths
	for (const poolList of poolLists) {
		if (poolList.length < 2) {
			continue;
		}
		paths.push({
			pools: poolList,
		});
	}
	return paths;
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
