# service-broker-webclient
Browser JavaScript library for communicating with the service broker

## Install
`npm install @service-broker/webclient`

## Usage
```javascript
import { ServiceBroker } from "@service-broker/webclient"

const sb = new ServiceBroker("wss://sb.mydomain.com", console)

sb.request({name: "my-service"}, {payload: "my-request"})
  .then(({payload}) => handleResult(payload))
```
