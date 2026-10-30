/**
 * app.js
 * Coordinador principal de la aplicación: Three.js Scene, UI, Galería, Snapping y BOM.
 */

import { BLOCK_CATALOG } from './block-catalog.js';
import { IfcLoaderManager } from './ifc-loader.js';
import { SnapEngine } from './snap-engine.js';
import { ProjectStorage } from './project-storage.js';
import { BomExporter } from './bom-exporter.js';

class BimApp {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.gridHelper = null;

        this.ifcLoader = null;
        this.snapEngine = null;

        this.currentIfcFileName = 'Sin_Modelo.ifc';
        this.currentCategory = 'hebel_75';

        this._initScene();
        this._initModules();
        this._initUIEvents();
        this._renderCatalog(this.currentCategory);
        this._animate();
    }

    /* ── 1. Inicialización de la Escena 3D Three.js ──────────────────────────── */
    _initScene() {
        const container = document.getElementById('viewport-container');
        const canvas = document.getElementById('three-canvas');

        // Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a2129);

        // Cámara
        const aspect = container.clientWidth / container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        this.camera.position.set(12, 10, 16);

        // Renderizador WebGL
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Controles orbitales tipo Trimble Connect
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.screenSpacePanning = true;
        this.controls.target.set(0, 2, 0);

        // Iluminación arquitectónica
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight1.position.set(20, 40, 20);
        dirLight1.castShadow = true;
        dirLight1.shadow.mapSize.width = 2048;
        dirLight1.shadow.mapSize.height = 2048;
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xa4b0be, 0.4);
        dirLight2.position.set(-20, 20, -20);
        this.scene.add(dirLight2);

        // Grilla de piso
        this.gridHelper = new THREE.GridHelper(50, 50, 0x00a8ff, 0x2f3542);
        this.gridHelper.position.y = -0.01;
        this.scene.add(this.gridHelper);

        // Redimensionamiento responsive
        window.addEventListener('resize', () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });
    }

    /* ── 2. Inicialización de Módulos (IFC, Snapping) ────────────────────────── */
    _initModules() {
        this.ifcLoader = new IfcLoaderManager();
        this.snapEngine = new SnapEngine(this.scene, this.camera, this.renderer, this.ifcLoader);

        // Vincular eventos del motor de snapping
        this.snapEngine.onBlocksChangedCallback = (blocks) => {
            this._updateBomView(blocks);
        };

        this.snapEngine.onBlockSelectedCallback = (block) => {
            this._updateSelectionInspector(block);
        };

        this.snapEngine.onBlockPlacedCallback = (block) => {
            document.querySelectorAll('.catalog-card').forEach(c => c.classList.remove('active-placing'));
        };
    }

    /* ── 3. Renderizado de la Galería de Bloques (con Drag & Drop nativo) ────── */
    _renderCatalog(categoryKey) {
        const container = document.getElementById('catalog-list-container');
        container.innerHTML = '';

        const catData = BLOCK_CATALOG[categoryKey];
        if (!catData) return;

        document.getElementById('active-category-badge').textContent = catData.category;

        catData.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'catalog-card';
            card.dataset.blockId = item.id;
            card.setAttribute('draggable', 'true');

            const isTophat = categoryKey === 'tophats';
            const dimensionText = isTophat 
                ? `${item.t}mm x ${item.w}mm • L: ${item.h}mm`
                : `Espesor: ${item.t}mm • Ancho: ${item.w}mm • Alto: ${item.h}mm`;

            const areaOrLen = isTophat
                ? `📏 ${(item.h / 1000).toFixed(1)} m lineal`
                : `📐 ${((item.w * item.h) / 1000000).toFixed(2)} m²`;

            card.innerHTML = `
                <div class="card-title">${item.name}</div>
                <div class="card-badges">
                    <span class="badge badge-blue">${dimensionText}</span>
                    <span class="badge">${areaOrLen}</span>
                    <span class="badge">⚖️ ${item.weightKg} kg</span>
                </div>
                <div class="card-footer">
                    <span>Arrastra al 3D o haz clic</span>
                    <span style="font-weight: 700; color: var(--accent-blue);">+ Añadir</span>
                </div>
            `;

            // Modo 1: Clic para activar colocación
            card.addEventListener('click', () => {
                document.querySelectorAll('.catalog-card').forEach(c => c.classList.remove('active-placing'));
                card.classList.add('active-placing');
                this.snapEngine.startPlacing(item.id);
            });

            // Modo 2: Drag & Drop arrastrando la tarjeta sobre el lienzo 3D
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.id);
                document.querySelectorAll('.catalog-card').forEach(c => c.classList.remove('active-placing'));
                card.classList.add('active-placing');
                this.snapEngine.startPlacing(item.id);
            });

            container.appendChild(card);
        });
    }

    /* ── 4. Actualización del Panel BOM e Inspector ─────────────────────────── */
    _updateBomView(placedBlocks) {
        const { summaryRows, totalStats } = BomExporter.calculateBom(placedBlocks);

        // Actualizar métricas de tarjetas
        document.getElementById('bom-total-units').textContent = `${totalStats.totalUnits} Bloques`;
        document.getElementById('metric-area').innerHTML = `${totalStats.totalAreaM2.toFixed(2)} <span style="font-size: 12px;">m²</span>`;
        document.getElementById('metric-length').innerHTML = `${totalStats.totalLengthM.toFixed(1)} <span style="font-size: 12px;">m</span>`;
        document.getElementById('metric-weight').innerHTML = `${totalStats.totalWeightKg.toFixed(0)} <span style="font-size: 12px;">kg</span>`;
        document.getElementById('metric-types').textContent = summaryRows.length;

        // Actualizar tabla de resumen
        const tbody = document.getElementById('bom-table-body');
        if (summaryRows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 20px;">
                        No hay bloques colocados todavía.<br>
                        Selecciona un panel de la galería y haz clic en el muro.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = summaryRows.map(row => `
            <tr>
                <td>
                    <div style="font-weight: 600;">${row.name}</div>
                    <div style="font-size: 10px; color: var(--text-secondary);">${row.category}</div>
                </td>
                <td style="text-align: center; font-weight: 700;">${row.count}</td>
                <td style="text-align: right; color: var(--accent-blue); font-weight: 600;">
                    ${row.totalAreaM2 > 0 ? `${row.totalAreaM2} m²` : `${row.totalLengthM} m`}
                </td>
            </tr>
        `).join('');
    }

    _updateSelectionInspector(selectedBlock) {
        const container = document.getElementById('inspector-content');
        if (!selectedBlock) {
            container.innerHTML = `<p style="font-size: 11px; color: var(--text-secondary);">Ningún bloque seleccionado.</p>`;
            return;
        }

        const ud = selectedBlock.userData || {};
        const pos = selectedBlock.position;

        // Desplegable para cambiar el bloque por otro tamaño/tipo.
        // La categoría actual aparece primero; luego el resto del catálogo.
        const catKeys = Object.keys(BLOCK_CATALOG);
        const currentCatKey = catKeys.find(k => BLOCK_CATALOG[k].items.some(i => i.id === ud.blockId));
        const orderedKeys = currentCatKey ? [currentCatKey, ...catKeys.filter(k => k !== currentCatKey)] : catKeys;
        const optionsHtml = orderedKeys.map(k => `
            <optgroup label="${BLOCK_CATALOG[k].category}">
                ${BLOCK_CATALOG[k].items.map(i => `<option value="${i.id}" ${i.id === ud.blockId ? 'selected' : ''}>${i.name}</option>`).join('')}
            </optgroup>`).join('');

        container.innerHTML = `
            <div class="prop-row" style="align-items: center;"><span class="prop-label">Componente:</span>
                <select id="inspector-block-select" class="inspector-select" title="Cambiar por otro tamaño">${optionsHtml}</select>
            </div>
            <div class="prop-row"><span class="prop-label">Categoría:</span> <span class="prop-val">${ud.category}</span></div>
            <div class="prop-row"><span class="prop-label">Medidas:</span> <span class="prop-val">${ud.thicknessMm}x${ud.widthMm}x${ud.heightMm} mm</span></div>
            <div class="prop-row"><span class="prop-label">Área:</span> <span class="prop-val">${ud.areaM2 || '-'} m²</span></div>
            <div style="font-size: 10px; color: var(--text-secondary); margin-top: 10px; margin-bottom: 4px; text-transform: uppercase; font-weight: 700;">Rotación 3D (90°):</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                <button id="btn-inspector-rot-z" class="btn btn-sm" title="Girar en Z (en plano del muro)">Girar Z [R]</button>
                <button id="btn-inspector-rot-x" class="btn btn-sm" title="Girar en X (cabeceo)">Girar X [E]</button>
                <button id="btn-inspector-rot-y" class="btn btn-sm" title="Girar en Y (guiñada)">Girar Y [T]</button>
            </div>
            <button id="btn-inspector-delete" class="btn btn-sm btn-danger" style="width: 100%; margin-top: 10px;">🗑️ Eliminar [Supr]</button>
        `;

        const blockSelect = document.getElementById('inspector-block-select');
        blockSelect.addEventListener('change', (e) => {
            const newId = e.target.value;
            e.target.blur(); // devolver el foco para que funcionen R / E / T / Supr
            this.snapEngine.replaceBlock(this.snapEngine.selectedBlock, newId);
        });

        document.getElementById('btn-inspector-rot-z').addEventListener('click', () => {
            this.snapEngine.rotateActiveBlock('Z');
        });

        document.getElementById('btn-inspector-rot-x').addEventListener('click', () => {
            this.snapEngine.rotateActiveBlock('X');
        });

        document.getElementById('btn-inspector-rot-y').addEventListener('click', () => {
            this.snapEngine.rotateActiveBlock('Y');
        });

        document.getElementById('btn-inspector-delete').addEventListener('click', () => {
            this.snapEngine.deleteSelectedBlock();
        });
    }

    /* ── 5. Gestión de UI y Eventos ─────────────────────────────────────────── */
    _initUIEvents() {
        // Pestañas del catálogo
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentCategory = btn.dataset.category;
                this._renderCatalog(this.currentCategory);
            });
        });

        // Carga de archivo IFC mediante input file
        const ifcInput = document.getElementById('ifc-file-input');
        document.getElementById('btn-open-ifc').addEventListener('click', () => ifcInput.click());
        ifcInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this._loadIfcFile(file);
            ifcInput.value = '';
        });

        // Botón para cargar muestra PSF760
        document.getElementById('btn-load-sample').addEventListener('click', () => {
            this._loadSampleModel('sample/PSF760.ifc', 'PSF760.ifc');
        });

        // Soporte de Drag & Drop sobre el Viewport (Tanto para archivos IFC como para bloques de catálogo)
        const viewport = document.getElementById('viewport-container');
        
        viewport.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.snapEngine.isPlacing) {
                this.snapEngine._onPointerMove(e);
            }
        });

        viewport.addEventListener('drop', (e) => {
            e.preventDefault();
            // Caso A: Si es un archivo IFC soltado
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.name.toLowerCase().endsWith('.ifc')) {
                    this._loadIfcFile(file);
                    return;
                }
            }

            // Caso B: Si es un bloque del catálogo arrastrado
            const blockId = e.dataTransfer.getData('text/plain');
            if (blockId && this.snapEngine.isPlacing && this.snapEngine.ghostMesh && this.snapEngine.ghostMesh.visible) {
                this.snapEngine._confirmPlacement();
            }
        });

        // Guardar y Cargar Proyecto JSON
        document.getElementById('btn-save-project').addEventListener('click', () => {
            ProjectStorage.exportProject(
                this.snapEngine.getPlacedBlocks(),
                this.currentIfcFileName,
                'Modulacion_Steel_Frame'
            );
        });

        const jsonInput = document.getElementById('json-project-input');
        document.getElementById('btn-load-project').addEventListener('click', () => jsonInput.click());
        jsonInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        ProjectStorage.importProject(ev.target.result, this.scene, this.snapEngine);
                    } catch (err) {
                        alert('Error al abrir proyecto: ' + err.message);
                    }
                };
                reader.readAsText(file);
            }
            jsonInput.value = '';
        });

        // Exportar a Excel
        document.getElementById('btn-export-excel').addEventListener('click', () => {
            const blocks = this.snapEngine.getPlacedBlocks();
            if (blocks.length === 0) {
                alert('Coloca al menos un bloque antes de exportar el reporte.');
                return;
            }
            BomExporter.exportToExcel(blocks, 'Modulacion_Steel_Hebel', this.currentIfcFileName);
        });

        // Imprimir / PDF
        document.getElementById('btn-print-report').addEventListener('click', () => {
            BomExporter.printReport(this.snapEngine.getPlacedBlocks(), 'Modulacion_Steel_Hebel', this.currentIfcFileName);
        });

        // Herramientas del Viewport
        document.getElementById('btn-view-iso').addEventListener('click', () => {
            this.camera.position.set(12, 10, 16);
            this.controls.target.set(0, 2, 0);
        });

        document.getElementById('btn-view-front').addEventListener('click', () => {
            this.camera.position.set(0, 2, 18);
            this.controls.target.set(0, 2, 0);
        });

        document.getElementById('btn-view-top').addEventListener('click', () => {
            this.camera.position.set(0, 22, 0.01);
            this.controls.target.set(0, 0, 0);
        });

        // Toggle visibilidad IFC
        let ifcVisible = true;
        document.getElementById('btn-toggle-ifc').addEventListener('click', () => {
            if (this.ifcLoader.loadedMeshGroup) {
                ifcVisible = !ifcVisible;
                this.ifcLoader.loadedMeshGroup.visible = ifcVisible;
                document.getElementById('btn-toggle-ifc').textContent = ifcVisible ? '👁️ IFC On' : '🕶️ IFC Off';
            }
        });

        // Toggle visibilidad Grilla de Piso
        let floorGridVisible = true;
        document.getElementById('btn-toggle-floor-grid').addEventListener('click', (e) => {
            floorGridVisible = !floorGridVisible;
            this.gridHelper.visible = floorGridVisible;
            e.target.textContent = floorGridVisible ? '🌐 Grilla: On' : '🌐 Grilla: Off';
        });

        // Toggle modo Revestimiento Exterior
        document.getElementById('btn-toggle-exterior').addEventListener('click', (e) => {
            this.snapEngine.exteriorMode = !this.snapEngine.exteriorMode;
            e.currentTarget.textContent = this.snapEngine.exteriorMode ? '🏠 Exterior: On' : '🏠 Exterior: Off';
        });

        // Toggle Snap a Grilla
        document.getElementById('btn-toggle-grid').addEventListener('click', (e) => {
            this.snapEngine.snapToGrid = !this.snapEngine.snapToGrid;
            e.target.textContent = this.snapEngine.snapToGrid ? '🧲 Snap: 50mm' : '🧲 Snap: Libre';
        });

        // Limpiar bloques
        document.getElementById('btn-clear-blocks').addEventListener('click', () => {
            if (confirm('¿Deseas eliminar todos los bloques colocados de la escena?')) {
                this.snapEngine.clearAllBlocks();
            }
        });
    }

    /* ── 6. Carga de Archivos IFC ───────────────────────────────────────────── */
    async _loadIfcFile(file) {
        this.currentIfcFileName = file.name;
        this._showProgressModal(true, `Cargando ${file.name}...`, 'Leyendo archivo binario');

        const reader = new FileReader();
        reader.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                this._updateProgress(pct * 0.2, `Leyendo disco: ${pct}%`);
            }
        };

        reader.onload = async (e) => {
            await this._processIfcBuffer(e.target.result, file.name);
        };

        reader.readAsArrayBuffer(file);
    }

    async _loadSampleModel(url, name) {
        this.currentIfcFileName = name;
        this._showProgressModal(true, `Cargando muestra ${name}...`, 'Obteniendo archivo local');
        try {
            const res = await fetch(url);
            const buffer = await res.arrayBuffer();
            await this._processIfcBuffer(buffer, name);
        } catch (err) {
            this._showProgressModal(false);
            alert('Error cargando modelo de muestra: ' + err.message);
        }
    }

    async _processIfcBuffer(buffer, name) {
        try {
            // Eliminar modelo previo de la escena si existe
            if (this.ifcLoader.loadedMeshGroup) {
                this.scene.remove(this.ifcLoader.loadedMeshGroup);
            }

            const modelGroup = await this.ifcLoader.loadIfcFromBuffer(buffer, (pct, status) => {
                this._updateProgress(pct, status);
            });

            this.scene.add(modelGroup);

            // Ajustar cámara para encuadrar la estructura
            const bounds = this.ifcLoader.getBounds();
            const size = new THREE.Vector3();
            bounds.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z, 5);

            this.camera.position.set(maxDim * 1.2, maxDim * 0.8, maxDim * 1.4);
            this.controls.target.set(0, size.y * 0.4, 0);
            this.controls.update();

            // Actualizar HUD
            document.getElementById('hud-model-info').style.display = 'flex';
            document.getElementById('hud-model-name').textContent = `Modelo: ${name}`;

            setTimeout(() => this._showProgressModal(false), 500);
        } catch (err) {
            console.error('[BimApp] Error procesando IFC:', err);
            this._showProgressModal(false);
            alert('No se pudo procesar el archivo IFC. Verifica la consola para más detalles.');
        }
    }

    _showProgressModal(show, title = '', subtitle = '') {
        const modal = document.getElementById('loading-modal');
        if (show) {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-subtitle').textContent = subtitle;
            this._updateProgress(0, subtitle);
            modal.classList.add('active');
        } else {
            modal.classList.remove('active');
        }
    }

    _updateProgress(pct, statusText) {
        const p = Math.min(Math.max(Math.round(pct), 0), 100);
        document.getElementById('modal-progress-fill').style.width = `${p}%`;
        document.getElementById('modal-percent').textContent = `${p}%`;
        if (statusText) {
            document.getElementById('modal-subtitle').textContent = statusText;
        }
    }

    /* ── 7. Loop de Renderizado ─────────────────────────────────────────────── */
    _animate() {
        requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar la aplicación cuando el DOM esté listo
window.addEventListener('DOMContentLoaded', () => {
    window.bimApp = new BimApp();
});
