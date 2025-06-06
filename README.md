# @service-broker/webclient
Browser ESM client library for communicating with a [service broker](https://github.com/service-broker/service-broker/wiki/specification).


### Install
```bash
npm install @service-broker/webclient
```


### Connect
Connect to a service broker at the provided WebSocket URL.

```javascript
import { ServiceBroker } from "@service-broker/webclient"

const sb = new ServiceBroker("wss://sb.mydomain.com", console)
```


### Request
Send a service request.  The broker will select a qualified provider based on service `name` and `capabilities`.  The parameter `request` contains the actual message that'll be delivered to the service provider.

```typescript
interface Message {
  header: {
    from: string      // the endpointId of the sender
    to: string        // the endpointId of the recipient
  },
  payload: string     // the message payload, usually JSON
}

sb.request(
  service: {
    name: string,
    capabilities?: string[]
  },
  request: Message,
  timeout?: number
): Promise<Message>
```


### Notify
A notification is like a request except no response will be sent.

```typescript
sb.notify(
  service: {
    name: string,
    capabilities?: string[]
  },
  notification: Message
): Promise<void>
```


### RequestTo
Send a service request directly to an endpoint.

```typescript
sb.requestTo(
  endpointId: string,
  serviceName: string,
  request: Message,
  timeout?: number
): Promise<Message>
```


### NotifyTo
Send a notification directly to an endpoint.

```typescript
sb.notifyTo(
  endpointId: string,
  serviceName: string,
  notification: Message
): Promise<void>
```


### SetServiceHandler
The `requestTo` and `notifyTo` methods can be used to send direct messages to other clients. For example, a chat service provider may publish a client's endpointId to other clients and allow them to send direct messages to each other.

This method sets a handler for incoming requests and notifications.

```typescript
sb.setServiceHandler(
  serviceName: string,
  handler: (request: Message) => Message|void|Promise<Message|void>
): void
```


### Publish/Subscribe
```typescript
sb.publish(
  topic: string,
  text: string
): Promise<void>

sb.subscribe(
  topic: string,
  handler: (text: string) => void
): Promise<void>
```
