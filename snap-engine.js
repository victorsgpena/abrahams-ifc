/**
 * snap-engine.js
 * Motor de Raycasting, Snapping a caras de perfiles de acero, bloques contiguos y plano de suelo.
 */

import { createBlockMesh, getBlockDefinition } from './block-catalog.js';

export class SnapEngine {
    constructor(scene, camera, renderer, ifcLoader) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.ifcLoader = ifcLoader;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.activeBlockDef = null;
        this.ghostMesh = null;
        this.isPlacing = false;
        
        // Rotaciones en 3 dimensiones en incrementos de 90° (0, PI/2, PI, 3PI/2)
        this.rotZ = 0; // Tecla R
        this.rotX = 0; // Tecla E
        this.rotY = 0; // Tecla T

        this.snapToGrid = true;
        this.gridSize = 0.05; // 50 mm

        this.placedBlocks = []; // Lista de grupos de bloques colocados en la escena
        this.selectedBlock = null;

        // Plano de suelo virtual (Y=0)
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        // Modo revestimiento exterior: fuerza que los paneles crezcan hacia afuera de la casa
        this.exteriorMode = false;
        // Máximo desplazamiento permitido para apoyar en la cara exterior del perfil (m)
        this.maxProfileDepth = 0.12;

        // Flecha guía que indica hacia dónde crecerá el panel
        this.directionArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.35, 0x2ed573, 0.08, 0.05
        );
        this.directionArrow.visible = false;
        this.scene.add(this.directionArrow);

        // Callbacks
        this.onBlockPlacedCallback = null;
        this.onBlockSelectedCallback = null;
        this.onBlocksChangedCallback = null;

        this._initEvents();
    }

    _initEvents() {
        const dom = this.renderer.domElement;

        dom.addEventListener('pointermove', (e) => this._onPointerMove(e));
        dom.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        
        // Teclas rápidas: R (rotar Z), E (rotar X), T (rotar Y), Supr (eliminar), Escape (cancelar)
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if (e.key === 'r' || e.key === 'R') {
                this.rotateActiveBlock('Z');
            } else if (e.key === 'e' || e.key === 'E') {
                this.rotateActiveBlock('X');
            } else if (e.key === 't' || e.key === 'T') {
                this.rotateActiveBlock('Y');
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.deleteSelectedBlock();
            } else if (e.key === 'Escape') {
                this.cancelPlacing();
            }
        });
    }

    /**
     * Inicia el modo de colocación para un tipo de bloque del catálogo.
     * @param {string} blockId ID del bloque
     */
    startPlacing(blockId) {
        const def = getBlockDefinition(blockId);
        if (!def) {
            console.warn(`[SnapEngine] Bloque no encontrado: ${blockId}`);
            return;
        }

        this.cancelPlacing();

        this.activeBlockDef = def;
        this.isPlacing = true;
        this.rotZ = 0;
        this.rotX = 0;
        this.rotY = 0;

        // Crear malla fantasma semitransparente con punto pivote verde
        this.ghostMesh = createBlockMesh(def, true);
        this.ghostMesh.visible = false;
        this.scene.add(this.ghostMesh);

        console.log(`[SnapEngine] Modo colocación activo para: ${def.name}`);
    }

    /**
     * Cancela el modo de colocación actual.
     */
    cancelPlacing() {
        if (this.ghostMesh) {
            this.scene.remove(this.ghostMesh);
            this.ghostMesh = null;
        }
        this.isPlacing = false;
        this.activeBlockDef = null;
        if (this.directionArrow) this.directionArrow.visible = false;
        // Restaurar estado visual en catálogo
        document.querySelectorAll('.catalog-card').forEach(c => c.classList.remove('active-placing'));
    }

    /**
     * Rota el bloque activo o seleccionado en incrementos de 90° en el eje indicado ('Z', 'X', 'Y').
     * @param {'Z'|'X'|'Y'} axis
     */
    rotateActiveBlock(axis = 'Z') {
        const halfPi = Math.PI / 2;

        if (this.isPlacing && this.ghostMesh) {
            if (axis === 'Z') {
                this.rotZ = (this.rotZ + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateZ(halfPi);
            } else if (axis === 'X') {
                this.rotX = (this.rotX + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateX(halfPi);
            } else if (axis === 'Y') {
                this.rotY = (this.rotY + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateY(halfPi);
            }
        } else if (this.selectedBlock) {
            if (axis === 'Z') this.selectedBlock.rotateZ(halfPi);
            else if (axis === 'X') this.selectedBlock.rotateX(halfPi);
            else if (axis === 'Y') this.selectedBlock.rotateY(halfPi);

            if (this.onBlocksChangedCallback) this.onBlocksChangedCallback(this.placedBlocks);
        }
    }

    _onPointerMove(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (!this.isPlacing || !this.ghostMesh) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Objetos contra los que se puede hacer snap: Mallas IFC + Bloques ya colocados
        const ifcMeshes = this.ifcLoader.getCollidableMeshes();
        const blockMeshes = [];
        this.placedBlocks.forEach(g => {
            g.traverse(child => {
                if (child.isMesh) blockMeshes.push(child);
            });
        });

        const targets = [...ifcMeshes, ...blockMeshes];
        const hits = targets.length > 0 ? this.raycaster.intersectObjects(targets, false) : [];

        if (hits.length > 0) {
            const hit = hits[0];
            const face = hit.face;

            if (face) {
                // Vector normal de la cara en coordenadas del mundo
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
                const worldNormal = face.normal.clone().applyMatrix3(normalMatrix).normalize();

                // (1) Con materiales DoubleSide y bastidores espejados la normal puede venir invertida:
                //     forzar que apunte hacia la cámara (el panel crece hacia el lado desde donde miras).
                if (worldNormal.dot(this.raycaster.ray.direction) > 0) worldNormal.negate();

                // (4) Modo revestimiento exterior: en caras verticales, la normal apunta lejos del centro del modelo
                if (this.exteriorMode && Math.abs(worldNormal.y) < 0.7) {
                    const center = new THREE.Vector3();
                    this.ifcLoader.getBounds().getCenter(center);
                    const outward = hit.point.clone().sub(center);
                    outward.y = 0;
                    if (worldNormal.dot(outward) < 0) worldNormal.negate();
                }

                // Distancia del punto de impacto a lo largo de la normal
                let normalDist = hit.point.dot(worldNormal);

                // (3) Apoyar sobre la cara más externa del perfil impactado (ala exterior del montante)
                if (hit.object.userData && hit.object.userData.isIfcElement) {
                    const box = new THREE.Box3().setFromObject(hit.object);
                    let maxDist = -Infinity;
                    for (let i = 0; i < 8; i++) {
                        const corner = new THREE.Vector3(
                            i & 1 ? box.max.x : box.min.x,
                            i & 2 ? box.max.y : box.min.y,
                            i & 4 ? box.max.z : box.min.z
                        );
                        maxDist = Math.max(maxDist, corner.dot(worldNormal));
                    }
                    const extra = maxDist - normalDist;
                    // Solo si el desplazamiento es razonable (profundidad de un perfil), evita saltos en diagonales
                    if (extra > 0 && extra <= this.maxProfileDepth) normalDist = maxDist;
                }

                // Margen de 0.5 mm para evitar z-fighting
                normalDist += 0.0005;

                // Componente del punto dentro del plano de la cara
                let inPlane = hit.point.clone().addScaledVector(worldNormal, -hit.point.dot(worldNormal));

                // (2) Snap de grilla SOLO dentro del plano de la cara (no hunde el panel en el acero)
                if (this.snapToGrid && this.gridSize > 0) {
                    inPlane.set(
                        Math.round(inPlane.x / this.gridSize) * this.gridSize,
                        Math.round(inPlane.y / this.gridSize) * this.gridSize,
                        Math.round(inPlane.z / this.gridSize) * this.gridSize
                    );
                    inPlane.addScaledVector(worldNormal, -inPlane.dot(worldNormal));
                }

                const targetPoint = inPlane.addScaledVector(worldNormal, normalDist);
                this.ghostMesh.position.copy(targetPoint);

                // Orientar el bloque: El eje Z local del bloque se alinea con la normal de la cara
                const defaultZ = new THREE.Vector3(0, 0, 1);
                const quat = new THREE.Quaternion().setFromUnitVectors(defaultZ, worldNormal);
                this.ghostMesh.quaternion.copy(quat);

                // Aplicar rotaciones del usuario en sus 3 dimensiones (R = Z, E = X, T = Y)
                if (this.rotZ !== 0) this.ghostMesh.rotateZ(this.rotZ);
                if (this.rotX !== 0) this.ghostMesh.rotateX(this.rotX);
                if (this.rotY !== 0) this.ghostMesh.rotateY(this.rotY);

                this.ghostMesh.visible = true;

                // (5) Flecha guía: hacia dónde crecerá el panel
                this.directionArrow.position.copy(targetPoint);
                this.directionArrow.setDirection(worldNormal);
                this.directionArrow.visible = true;
            }
        } else {
            // Snapping de apoyo en el suelo (Y=0) si no se intersecta con la estructura
            this.directionArrow.visible = false;
            const groundHit = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.groundPlane, groundHit)) {
                let targetPoint = groundHit.clone();

                if (this.snapToGrid && this.gridSize > 0) {
                    targetPoint.x = Math.round(targetPoint.x / this.gridSize) * this.gridSize;
                    targetPoint.z = Math.round(targetPoint.z / this.gridSize) * this.gridSize;
                }

                // El extremo inferior ya coincide con Y = 0
                targetPoint.y = 0;

                this.ghostMesh.position.copy(targetPoint);
                this.ghostMesh.rotation.set(this.rotX, this.rotY, this.rotZ);
                this.ghostMesh.visible = true;
            } else {
                this.ghostMesh.visible = false;
            }
        }
    }

    _onPointerDown(e) {
        if (e.button !== 0) return;

        if (this.isPlacing && this.ghostMesh && this.ghostMesh.visible) {
            this._confirmPlacement();
            e.stopPropagation();
            return;
        }

        this._handleSelection();
    }

    _confirmPlacement() {
        const newBlock = createBlockMesh(this.activeBlockDef, false);
        newBlock.position.copy(this.ghostMesh.position);
        newBlock.quaternion.copy(this.ghostMesh.quaternion);

        this.scene.add(newBlock);
        this.placedBlocks.push(newBlock);

        console.log(`[SnapEngine] Bloque colocado: ${this.activeBlockDef.name} en (${newBlock.position.x.toFixed(2)}, ${newBlock.position.y.toFixed(2)}, ${newBlock.position.z.toFixed(2)})`);

        if (this.onBlockPlacedCallback) {
            this.onBlockPlacedCallback(newBlock, this.placedBlocks);
        }
        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }

        this.selectBlock(newBlock);
    }

    _handleSelection() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const blockMeshes = [];
        const meshToGroup = new Map();

        this.placedBlocks.forEach(group => {
            group.traverse(child => {
                if (child.isMesh) {
                    blockMeshes.push(child);
                    meshToGroup.set(child, group);
                }
            });
        });

        const hits = this.raycaster.intersectObjects(blockMeshes, false);
        if (hits.length > 0) {
            const hitGroup = meshToGroup.get(hits[0].object);
            this.selectBlock(hitGroup);
        } else {
            this.selectBlock(null);
        }
    }

    selectBlock(blockGroup) {
        if (this.selectedBlock && this.selectedBlock !== blockGroup) {
            this._setHighlight(this.selectedBlock, false);
        }

        this.selectedBlock = blockGroup;

        if (this.selectedBlock) {
            this._setHighlight(this.selectedBlock, true);
        }

        if (this.onBlockSelectedCallback) {
            this.onBlockSelectedCallback(this.selectedBlock);
        }
    }

    _setHighlight(group, isHighlighted) {
        group.traverse(child => {
            if (child.isMesh && child.material) {
                if (isHighlighted) {
                    child.material.emissive = new THREE.Color(0x0984e3);
                    child.material.emissiveIntensity = 0.35;
                } else {
                    child.material.emissive = new THREE.Color(0x000000);
                    child.material.emissiveIntensity = 0;
                }
            }
        });
    }

    /**
     * Reemplaza un bloque colocado por otro tipo del catálogo, conservando
     * el punto de inserción (extremo inferior derecho) y la orientación.
     * @param {THREE.Group} oldBlock
     * @param {string} newBlockId
     * @returns {THREE.Group|null}
     */
    replaceBlock(oldBlock, newBlockId) {
        const def = getBlockDefinition(newBlockId);
        const idx = this.placedBlocks.indexOf(oldBlock);
        if (!def || idx === -1) return null;

        const newBlock = createBlockMesh(def, false);
        newBlock.position.copy(oldBlock.position);
        newBlock.quaternion.copy(oldBlock.quaternion);

        this.scene.remove(oldBlock);
        this.scene.add(newBlock);
        this.placedBlocks[idx] = newBlock;

        this.selectedBlock = null;
        this.selectBlock(newBlock);

        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }
        console.log(`[SnapEngine] Bloque reemplazado por: ${def.name}`);
        return newBlock;
    }

    deleteSelectedBlock() {
        if (!this.selectedBlock) return;

        const idx = this.placedBlocks.indexOf(this.selectedBlock);
        if (idx !== -1) {
            this.scene.remove(this.selectedBlock);
            this.placedBlocks.splice(idx, 1);
            this.selectBlock(null);

            if (this.onBlocksChangedCallback) {
                this.onBlocksChangedCallback(this.placedBlocks);
            }
            console.log('[SnapEngine] Bloque eliminado.');
        }
    }

    clearAllBlocks() {
        this.placedBlocks.forEach(b => this.scene.remove(b));
        this.placedBlocks = [];
        this.selectBlock(null);
        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }
    }

    getPlacedBlocks() {
        return this.placedBlocks;
    }
}
