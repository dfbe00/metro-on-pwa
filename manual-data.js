// manual-data.js — Mini Manual Técnico Offline, Estaciones y Avisos de Metro-ON

export const METRO_STATIONS = [
  "Los Leones",
  "Baquedano",
  "Universidad de Chile",
  "Hospitales",
  "Tobalaba",
  "San Joaquín",
  "Plaza de Armas",
  "Escuela Militar",
  "Santa Isabel"
];

export const FAULT_TYPES = [
  "No operativo",
  "Falla eléctrica",
  "Sensor de puerta descalibrado",
  "Desgaste mecánico / Rodamiento",
  "Detención en hora punta",
  "Falla en lector / Torniquete"
];

export const INITIAL_AVISOS = [
  {
    id: "AV-01",
    asset_id: "A-03",
    station: "Los Leones",
    equipment: "Ascensor A-03",
    equipment_type: "Ascensor",
    fault_type: "No operativo",
    priority: "Prioridad Alta",
    title: "Objetivo Metro: Ascensor A-03 Acceso General — Est. Los Leones",
    detail:
      "Revisar sensor óptico de cierre de puerta (SP-102) y calibrar haz infrarrojo. Explicar por audio qué repuesto se instaló y adjuntar fotografías Antes y Después."
  },
  {
    id: "AV-02",
    asset_id: "E-12",
    station: "Baquedano",
    equipment: "Escalera E-12",
    equipment_type: "Escalera mecánica",
    fault_type: "Desgaste mecánico / Rodamiento",
    priority: "Prioridad Crítica",
    title: "Objetivo Metro: Escalera E-12 Combinación L1-L5 — Est. Baquedano",
    detail:
      "Verificar holgura de rodamiento guía SKF-6205 y ajuste de placa peine PP-08. Realizar prueba continua de 15 minutos con Jefe de Estación antes de retirar cierre."
  },
  {
    id: "AV-03",
    asset_id: "A-07",
    station: "Hospitales",
    equipment: "Ascensor A-07",
    equipment_type: "Ascensor",
    fault_type: "Falla eléctrica",
    priority: "Prioridad Crítica",
    title: "Objetivo Metro: Ascensor A-07 Accesibilidad — Est. Hospitales",
    detail:
      "Atención prioritaria por flujo de pacientes (Ley 20.422). Verificar fuente de poder 24V (FP-24); si falta stock en bodega, registrar reporte como Pendiente (faltan materiales)."
  }
];

export const TECHNICAL_MANUAL_GUIDES = [
  {
    id: "MAN-ASC-01",
    equipment_type: "Ascensor",
    title: "Falla en sensor óptico de puerta (cortina / fotocélula)",
    symptom: "Puertas no cierran completamente o reabren de forma intermitente; indicador luminoso rojo en dintel.",
    cause: "Desalineación del emisor/receptor, suciedad en riel inferior o falla eléctrica en sensor SP-102.",
    steps: [
      "Aislar área con vallas perimetrales y confirmar desenergización en tablero de maniobra.",
      "Limpiar guía inferior de puerta y verificar continuidad del cableado de 24V DC.",
      "Si el LED del receptor parpadea en rojo sin obstrucción, reemplazar el sensor por repuesto homologado SP-102.",
      "Ejecutar 10 ciclos completos de apertura/cierre sin carga y tomar fotografía Antes y Después."
    ],
    part_code: "SP-102",
    safety_note: "Aplicar bloqueo LOTO antes de intervenir marco o tarjeta controladora de cabina."
  },
  {
    id: "MAN-ASC-02",
    equipment_type: "Ascensor",
    title: "Detención por falla eléctrica o caída de fuente 24V",
    symptom: "Cabina detenida en nivel, botonera de llamado apagada y falla de comunicación en controlador.",
    cause: "Sobrevoltaje en línea auxiliar o agotamiento de fuente conmutada 24V (FP-24) / fusible de maniobra.",
    steps: [
      "Medir tensión de salida en bornes +24V / GND de la fuente principal.",
      "Revisar estado de protecciones termomagnéticas en cuarto de máquinas o dintel.",
      "Reemplazar fuente FP-24 si el voltaje cae bajo 21.5V bajo carga; de no haber stock, marcar 'Pendiente (faltan materiales)'.",
      "Coordinar prueba de nivelación y rescate con Jefe de Estación antes de habilitar servicio."
    ],
    part_code: "FP-24",
    safety_note: "Verificar ausencia de tensión (0V) con multímetro certificado antes de desconectar bornes."
  },
  {
    id: "MAN-ASC-03",
    equipment_type: "Ascensor",
    title: "Vibración o desgaste en motor de tracción / puertas",
    symptom: "Ruido metálico al arranque, frenado brusco o consumo elevado de corriente en variador.",
    cause: "Desgaste de rodamientos o bobinado fatigado en motor de tracción (M-210).",
    steps: [
      "Registrar temperatura superficial del motor y holgura en acoplamiento.",
      "Verificar historial de intervenciones del equipo para descartar reincidencia recurrente.",
      "Si el ruido persiste tras lubricación y ajuste de freno, programar cambio de unidad M-210."
    ],
    part_code: "M-210",
    safety_note: "Prohibido operar cabina con pasajeros durante pruebas de freno o tracción."
  },
  {
    id: "MAN-ESC-01",
    equipment_type: "Escalera mecánica",
    title: "Vibración o ruido anormal en rodamiento guía superior",
    symptom: "Golpeteo rítmico en cabecera superior o disparo de microswitch de seguridad de peldaño.",
    cause: "Fatiga o gripa de rodamiento guía SKF-6205 por acumulación de polvo metálico.",
    steps: [
      "Cerrar acceso superior e inferior con vallas de seguridad Metro.",
      "Retirar placa de acceso de cabecera y revisar juego axial del rodamiento guía.",
      "Reemplazar rodamiento SKF-6205 y verificar torque de fijación según especificación.",
      "Probar marcha continua durante 15 minutos sin vibraciones ni alarma de peine."
    ],
    part_code: "SKF-6205",
    safety_note: "Activar parada de emergencia con llave y bloquear interruptor principal bajo placa."
  },
  {
    id: "MAN-ESC-02",
    equipment_type: "Escalera mecánica",
    title: "Desalineación o dientes fracturados en placa peine",
    symptom: "Detención inmediata por contacto de seguridad de placa peine (combplate switch).",
    cause: "Atasco por objeto extraño o desgaste en dientes de placa peine PP-08.",
    steps: [
      "Inspeccionar visualmente los dientes de la placa peine superior e inferior.",
      "Si faltan 2 o más dientes contiguos, reemplazar módulo PP-08 completo.",
      "Calibrar holgura peine-peldaño (máximo 4 mm) y rearmar contacto de seguridad."
    ],
    part_code: "PP-08",
    safety_note: "No puentear nunca el microswitch de seguridad de placa peine."
  },
  {
    id: "MAN-TOR-01",
    equipment_type: "Torniquete / Peaje BIP",
    title: "Traba mecánica de aspas o falla de solenoide de destrabe",
    symptom: "Validador BIP aprueba el pasaje (luz verde) pero el torniquete permanece bloqueado.",
    cause: "Bobina abierta en solenoide SOL-24V o resorte de retorno fatigado.",
    steps: [
      "Retirar tapa superior con llave triangular Metro.",
      "Medir resistencia de bobina del solenoide SOL-24V y verificar pulso de 24V al validar.",
      "Reemplazar solenoide SOL-24V, lubricar trinquete y validar 5 pasajes de prueba."
    ],
    part_code: "SOL-24V",
    safety_note: "Verificar que el modo liberación de emergencia quede operativo al cerrar la tapa."
  },
  {
    id: "MAN-GEN-01",
    equipment_type: "Protocolo Seguridad",
    title: "Protocolo por humedad o filtración de agua en foso",
    symptom: "Presencia de agua estancada o filtración activa en foso de ascensor o pozo de escalera.",
    cause: "Napa subterránea o falla en bomba sentina / drenaje de estación.",
    steps: [
      "Desenergizar el equipo de inmediato y colocar señalética de equipo bloqueado.",
      "Fotografiar el nivel de agua en la sección 'Antes' del reporte Metro-ON.",
      "Marcar el reporte en estado 'Pendiente (faltan materiales)' o solicitar en Chat apoyo de Obras Civiles antes de reenergizar."
    ],
    part_code: "",
    safety_note: "Riesgo eléctrico severo: jamás descender al foso energizado o con nivel de agua sobre tablero."
  }
];
