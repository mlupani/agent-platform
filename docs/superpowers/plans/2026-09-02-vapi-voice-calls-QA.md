# QA manual — Asistente de voz (Vapi)

Requiere: cuenta Vapi con crédito, un número comprado, API pública accesible
(ngrok/deploy) porque Vapi tiene que llegar a `${API_URL}/api/webhooks/vapi`.

## Verificar contra la doc de Vapi al probar (spec §10)

- [ ] `model.url`: confirmar si Vapi le agrega `/chat/completions`. Si NO, cambiar
      `buildTransientAssistant` para mandar la URL completa y ajustar la ruta del bridge.
- [ ] Header del secret: confirmar que llega como `x-vapi-secret` (case-insensitive).
      Si Vapi usa otro esquema para `model.headers`, ajustar `verifySecret` / el header.
- [ ] `PATCH /phone-number/{id}`: confirmar que acepta `server.secret` inline y que no
      hace falta re-mandar el discriminador `provider`. Si lo exige, mergear el objeto
      remoto en `applyServerUrl`.
- [ ] Transcriber `flux-general-multi`: confirmar que soporta `es`. Si no, usar
      `nova-3` con `language: 'es'`.
- [ ] Voces del `<select>`: confirmar cuáles están activas (v2).

## Flujo end-to-end

- [ ] Admin → Integraciones → Llamadas: pegar API key → el `<select>` lista los números.
- [ ] Elegir número + Guardar → status "Conectado", `lastSyncedAt` seteado.
- [ ] En el dashboard de Vapi, el número quedó sin assistant y con el server URL nuestro.
- [ ] Llamar al número. El asistente saluda con el primer mensaje.
- [ ] Preguntar por horarios/servicios → responde corto, hablado, sin listas.
- [ ] Pedir un turno → ejecuta tools (checkAvailability/createAppointment); tolera la
      demora ("dame un momento").
- [ ] Cortar. En Conversaciones aparece la conversación canal *Llamada* con la
      transcripción turno a turno.
- [ ] `GET /admin/calls/logs` (o la tabla): la llamada con `durationSeconds`, `costUsd`,
      `summary`, `endedReason`.
- [ ] Toggle **Asistente activo** off → llamar → Vapi corta con el mensaje de no disponible.
- [ ] Toggle **Habilitado** off → idem.
- [ ] Observabilidad: hay `AgentExecution` por turno (Playground / analytics).

## Hardening pendiente (post-MVP)

- [ ] **Conversación duplicada por race.** `VapiWebhookService.upsertConversation` y
      `VapiBridgeService.resolveConversation` hacen `findFirst` + `create` sin lock ni
      constraint único. Un `assistant-request` reintentado por Vapi (o el primer turno
      llegando antes de que el `create` del assistant-request commitee) puede crear 2
      filas `Conversation` VOICE para una misma llamada. El `CallLog` es idempotente
      (`upsert` por `vapiCallId`), así que no se pierde el registro; el síntoma es una
      fila de más en la bandeja. Fix: helper compartido con lock Redis
      (`RedisService.acquireLock`, patrón de `WhatsAppWebhookService.claimExternalId`),
      o `@@unique([businessId, channel, externalId])` en `Conversation` (evaluar impacto
      en la dedup de WhatsApp, que hoy maneja duplicados cerrándolos).
- [ ] **`getForRuntime()` sin guard en `handleAssistantRequest`.** Si la DB está caída,
      cargar la config tira 500 a Vapi en el `assistant-request` (en vez de un `{ error }`
      controlado). Cuando pasa eso toda la plataforma está caída y la llamada falla igual,
      pero por consistencia con el contrato never-500: envolver la carga de config en el
      branch `assistant-request` de `handleEvent`.
- [ ] **Copy de cards.** La card "Llamadas" del hub dice "Asistente activo/inactivo";
      las otras cards dicen "Agente activo/inactivo". Uniformar si se quiere consistencia.
- [ ] **`finalizeFromReport` segundo `conversation.update` fuera del try/catch** — un
      `conversationId` que apunta a una conversación borrada tira después de haber
      actualizado el `CallLog`. El webhook controller no lo envuelve. Bajo impacto.
- [ ] **`VapiClient` sin `AbortController`** — timeouts repetidos apilan requests in-flight.
