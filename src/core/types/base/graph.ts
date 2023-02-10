import { isNativeAsset } from "./asset";
import { Pool } from "./pool";

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

// func (graph *Graph) GetPaths(start string, depth int) (paths []*Path) {
// 	var root *Vertex
// 	var ok bool
// 	if root, ok = graph.Vertices[start]; !ok {
// 		return
// 	}

// 	// Explore possible vertex paths
// 	edgeLists := root.DepthFirstSearch(start, depth)

// 	// Expand compressed edge structure
// 	hopLists := [][]*ww_hops.Hop{}
// 	for _, edgeList := range edgeLists {
// 		newHopLists := [][]*ww_hops.Hop{}
// 		for _, edge := range edgeList {
// 			newHopLists = edge.Expand(newHopLists)
// 			if len(newHopLists) == 0 {
// 				break
// 			}
// 		}
// 		hopLists = append(hopLists, newHopLists...)
// 	}

// 	// Create paths
// 	var path *Path
// 	var err error
// 	for _, hopList := range hopLists {
// 		if len(hopList) < 2 {
// 			continue
// 		}
// 		if path, err = New(start, hopList); err != nil {
// 			logrus.Fatal(hopList)
// 		}
// 		paths = append(paths, path)
// 	}

// 	return
// }

// **************************************** VERTEX **************************************** \\

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
function DepthFirstSearch(vertex: Vertex, start: string, depth: number): Array<Array<Edge>> {
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
			for (const edgeList of DepthFirstSearch(edge.to, start, depth - 1)) {
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
function expandEdge(this: Edge, oldLists: Array<Array<Pool>>): Array<Array<Pool>> {
	const newHopLists: Array<Array<Pool>> = [];
	if (oldLists.length === 0) {
		for (const pool of this.pools) {
			newHopLists.push([pool]);
		}
	} else {
		for (const pool of this.pools) {
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
