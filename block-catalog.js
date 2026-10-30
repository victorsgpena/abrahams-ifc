/**
 * block-catalog.js
 * Definición del catálogo de bloques paramétricos 3D (Paneles Hebel y Perfiles Tophat).
 * Unidades estándar en milímetros (mm) convertidas a metros (m) para la escena 3D.
 */

export const BLOCK_CATALOG = {
    hebel_75: {
        category: 'Hebel 75mm',
        description: 'Paneles de hormigón celular curado en autoclave (AAC) para cerramientos y muros.',
        thickness: 75, // mm
        width: 600,    // mm
        color: 0xdedede, // Tono hormigón claro
        edgeColor: 0x4a4a4a,
        items: [
            { id: 'hb-75-2280', name: 'Hebel Panel 75 x 600 x 2280', t: 75, w: 600, h: 2280, weightKg: 72 },
            { id: 'hb-75-2400', name: 'Hebel Panel 75 x 600 x 2400', t: 75, w: 600, h: 2400, weightKg: 76 },
            { id: 'hb-75-2550', name: 'Hebel Panel 75 x 600 x 2550', t: 75, w: 600, h: 2550, weightKg: 80 },
            { id: 'hb-75-2700', name: 'Hebel Panel 75 x 600 x 2700', t: 75, w: 600, h: 2700, weightKg: 85 },
            { id: 'hb-75-2850', name: 'Hebel Panel 75 x 600 x 2850', t: 75, w: 600, h: 2850, weightKg: 90 },
            { id: 'hb-75-3000', name: 'Hebel Panel 75 x 600 x 3000', t: 75, w: 600, h: 3000, weightKg: 95 },
            { id: 'hb-75-3300', name: 'Hebel Panel 75 x 600 x 3300', t: 75, w: 600, h: 3300, weightKg: 104 }
        ]
    },
    hebel_50: {
        category: 'PowerPanel 50mm',
        description: 'Paneles Hebel de 50mm para cerramientos livianos, balcones y particiones.',
        thickness: 50, // mm
        width: 600,    // mm
        color: 0xd2d7db,
        edgeColor: 0x3d4449,
        items: [
            { id: 'hb-50-1800', name: 'Hebel PowerPanel 50 x 600 x 1800', t: 50, w: 600, h: 1800, weightKg: 38 },
            { id: 'hb-50-2400', name: 'Hebel PowerPanel 50 x 600 x 2400', t: 50, w: 600, h: 2400, weightKg: 50 },
            { id: 'hb-50-2700', name: 'Hebel PowerPanel 50 x 600 x 2700', t: 50, w: 600, h: 2700, weightKg: 57 },
            { id: 'hb-50-3000', name: 'Hebel PowerPanel 50 x 600 x 3000', t: 50, w: 600, h: 3000, weightKg: 63 }
        ]
    },
    tophats: {
        category: 'Perfilería Tophat',
        description: 'Perfiles omega / tophats de acero galvanizado para fijación y ventilación de fachada.',
        thickness: 24, // mm (altura/peralte)
        width: 40,     // mm (base)
        color: 0x487eb0, // Tono metálico azulado
        edgeColor: 0x192a56,
        items: [
            { id: 'th-24-40-6000', name: 'Tophat 24mm x 40mm x 6000mm', t: 24, w: 40, h: 6000, weightKg: 4.8 },
            { id: 'th-24-61-6000', name: 'Tophat 24mm x 61mm x 6000mm', t: 24, w: 61, h: 6000, weightKg: 5.6 },
            { id: 'th-35-50-6000', name: 'Tophat 35mm x 50mm x 6000mm', t: 35, w: 50, h: 6000, weightKg: 6.5 }
        ]
    }
};

/**
 * Busca un bloque en el catálogo por su identificador único.
 */
export function getBlockDefinition(itemId) {
    for (const catKey of Object.keys(BLOCK_CATALOG)) {
        const cat = BLOCK_CATALOG[catKey];
        const item = cat.items.find(i => i.id === itemId);
        if (item) {
            return {
                ...item,
                categoryKey: catKey,
                categoryName: cat.category,
                color: cat.color,
                edgeColor: cat.edgeColor
            };
        }
    }
    return null;
}

/**
 * Crea una malla 3D de Three.js para un bloque del catálogo con bordes visibles.
 * Las dimensiones se convierten de mm a metros (Three.js estándar: 1 unidad = 1 metro).
 * @param {Object} def Definición del bloque
 * @param {boolean} isGhost Si es true, se renderiza semitransparente para previsualización durante el drag & drop.
 * @returns {THREE.Group}
 */
export function createBlockMesh(def, isGhost = false) {
    const scale = 0.001; // mm a metros
    const width = (def.w || 600) * scale;
    const height = (def.h || 2400) * scale;
    const thickness = (def.t || 75) * scale;

    const group = new THREE.Group();
    group.name = `block_${def.id}_${Date.now()}`;

    // Geometría con pivote en el EXTREMO INFERIOR DERECHO:
    // X: [-width, 0]       -> El borde derecho está en X = 0
    // Y: [0, height]       -> La base (extremo inferior) está en Y = 0
    // Z: [0, thickness]    -> La cara de apoyo en la pared está en Z = 0
    const geom = new THREE.BoxGeometry(width, height, thickness);
    geom.translate(-width / 2, height / 2, thickness / 2);

    // Material de cara
    const mat = new THREE.MeshStandardMaterial({
        color: isGhost ? 0x00a8ff : def.color,
        roughness: 0.85,
        metalness: def.categoryKey === 'tophats' ? 0.6 : 0.05,
        transparent: isGhost,
        opacity: isGhost ? 0.6 : 1.0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = !isGhost;
    mesh.receiveShadow = !isGhost;
    group.add(mesh);

    // Bordes para visualizar las juntas de modulación de los paneles
    const edgesGeom = new THREE.EdgesGeometry(geom);
    const edgesMat = new THREE.LineBasicMaterial({
        color: isGhost ? 0x00d2d3 : def.edgeColor,
        linewidth: 2,
        transparent: isGhost,
        opacity: isGhost ? 0.85 : 0.95
    });
    const wireframe = new THREE.LineSegments(edgesGeom, edgesMat);
    group.add(wireframe);

    // Indicador visual del punto de snap (punto inferior derecho) durante la colocación
    if (isGhost) {
        const pivotGeom = new THREE.SphereGeometry(0.02, 12, 12);
        const pivotMat = new THREE.MeshBasicMaterial({ color: 0x2ed573 });
        const pivotMesh = new THREE.Mesh(pivotGeom, pivotMat);
        pivotMesh.position.set(0, 0, 0);
        group.add(pivotMesh);
    }

    // Metadatos asociados al objeto 3D
    group.userData = {
        isBimBlock: true,
        blockId: def.id,
        name: def.name,
        category: def.categoryName || def.categoryKey,
        thicknessMm: def.t,
        widthMm: def.w,
        heightMm: def.h,
        weightKg: def.weightKg || 0,
        areaM2: ((def.w * def.h) / 1000000).toFixed(3),
        lengthM: (def.h / 1000).toFixed(2),
        createdTimestamp: Date.now()
    };

    return group;
}
