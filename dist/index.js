function messageFromString(text) {
    const index = text.indexOf('\n');
    if (index == -1) {
        return {
            header: JSON.parse(text)
        };
    }
    else {
        return {
            header: JSON.parse(text.slice(0, index)),
            payload: text.slice(index + 1)
        };
    }
}
export class ServiceBroker {
    constructor(url) {
        this.url = url;
        this.providers = new Map();
        this.ws = null;
        this.connectListeners = [];
        this.pendingSend = [];
        this.pendingResponses = new Map();
        this.pendingIdGen = 0;
        this.connect();
    }
    connect() {
        const conn = new WebSocket(this.url);
        conn.onopen = () => this.onOpen(conn);
        conn.onerror = () => {
            console.error("Failed to connect to service broker, retrying in 15");
            setTimeout(() => this.connect(), 15000);
        };
    }
    onOpen(conn) {
        this.ws = conn;
        this.ws.onerror = console.error;
        this.ws.onclose = () => this.onClose();
        this.ws.onmessage = event => this.onMessage(event);
        for (const listener of this.connectListeners)
            listener();
        for (const { header, payload } of this.pendingSend)
            this.send(header, payload);
        this.pendingSend = [];
    }
    onClose() {
        this.ws = null;
        console.error("Lost connection to service broker, reconnecting");
        setTimeout(() => this.connect(), 0);
    }
    onMessage(e) {
        const msg = messageFromString(e.data);
        console.debug("<<", msg.header, msg.payload);
        if (msg.header.type == "ServiceResponse")
            this.onServiceResponse(msg);
        else if (msg.header.type == "ServiceRequest")
            this.onServiceRequest(msg);
        else if (msg.header.type == "SbStatusResponse")
            this.onServiceResponse(msg);
        else if (msg.header.error)
            this.onServiceResponse(msg);
        else
            console.error("Unhandled", msg.header);
    }
    onServiceResponse(message) {
        const id = message.header.id;
        const pendingResponse = this.pendingResponses.get(id);
        if (pendingResponse) {
            this.pendingResponses.delete(id);
            if (message.header.error) {
                pendingResponse.reject(new Error(message.header.error));
            }
            else {
                pendingResponse.fulfill(message);
            }
        }
        else {
            console.error("Response received but no pending request", message.header);
        }
    }
    onServiceRequest(msg) {
        const service = msg.header.service;
        const provider = this.providers.get(service.name);
        if (provider) {
            Promise.resolve(provider.handler(msg))
                .then(res => {
                if (msg.header.id) {
                    this.send(Object.assign(Object.assign({}, res === null || res === void 0 ? void 0 : res.header), { to: msg.header.from, id: msg.header.id, type: "ServiceResponse" }), res === null || res === void 0 ? void 0 : res.payload);
                }
            })
                .catch(err => {
                if (msg.header.id) {
                    this.send({
                        to: msg.header.from,
                        id: msg.header.id,
                        type: "ServiceResponse",
                        error: err.message || err
                    });
                }
                else {
                    console.error(err.message, msg.header);
                }
            });
        }
        else {
            console.error("No handler for service " + service.name);
        }
    }
    send(header, payload) {
        if (!this.ws) {
            this.pendingSend.push({ header, payload });
            return;
        }
        console.debug(">>", header, payload);
        if (payload) {
            this.ws.send(JSON.stringify(header) + "\n" + payload);
        }
        else {
            this.ws.send(JSON.stringify(header));
        }
    }
    request(service, req) {
        return this.requestTo(null, service, req);
    }
    requestTo(endpointId, service, req) {
        const id = ++this.pendingIdGen;
        const promise = new Promise((fulfill, reject) => {
            this.pendingResponses.set(id, { fulfill, reject });
        });
        const header = {
            id: id,
            type: "ServiceRequest",
            service
        };
        if (endpointId)
            header.to = endpointId;
        this.send(Object.assign(Object.assign({}, req.header), header), req.payload);
        return promise;
    }
    advertise(service, handler) {
        if (this.providers.has(service.name)) {
            throw new Error(service.name + " provider already exists");
        }
        this.providers.set(service.name, { advertisedService: service, handler });
        return this.send({
            type: "SbAdvertiseRequest",
            services: Array.from(this.providers.values())
                .filter(x => x.advertisedService)
                .map(x => x.advertisedService)
        });
    }
    unadvertise(serviceName) {
        if (!this.providers.delete(serviceName)) {
            throw new Error(serviceName + " provider not exists");
        }
        return this.send({
            type: "SbAdvertiseRequest",
            services: Array.from(this.providers.values())
                .filter(x => x.advertisedService)
                .map(x => x.advertisedService)
        });
    }
    setServiceHandler(serviceName, handler) {
        if (this.providers.has(serviceName)) {
            throw new Error("Handler already exists");
        }
        this.providers.set(serviceName, { handler });
    }
    publish(topic, text) {
        return this.send({ type: "ServiceRequest", service: { name: "#" + topic } }, text);
    }
    subscribe(topic, handler) {
        return this.advertise({ name: "#" + topic }, msg => handler(msg.payload));
    }
    unsubscribe(topic) {
        return this.unadvertise("#" + topic);
    }
    isConnected() {
        return this.ws != null;
    }
    addConnectListener(listener) {
        this.connectListeners.push(listener);
        if (this.isConnected())
            listener();
    }
}
