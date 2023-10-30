const AMI = require('yana')
const EventEmitter = require('events').EventEmitter;
const Client = require('./models/Client')

const sab = new SharedArrayBuffer(1024);
const AtomicID = new Uint8Array(sab);

AtomicID[0] = 1

class Ami {
    constructor(io, userList, events = true) {
        this.clientModel = new Client()

        const params = {
            events,
            login: global.env.AMI_USER || 'ibridge',
            password: global.env.AMI_PASSWORD  || 'ibridge',
            host: global.env.AMI_HOST || 'localhost',
            port: global.env.AMI_PORT || 5038,
            reconnect: true
        }

        this.io = io
        this.userList = userList

        this.emitter = new EventEmitter()
        this.userList.get('endpointsData').then(data => {
            const endpointsdata = (data) ? JSON.parse(data) : {} 
            Object.keys(endpointsdata).forEach(endp => {endpointsdata[endp].queues = {}})
            this.endpoints = new Proxy(endpointsdata, {
                emitter: this.emitter,
                set: (obj, prop, value) => {
                    obj[prop] = value
                    this.emitter.emit('endpointChange', prop, value)
                    return true
                }
            })
        })

        this.userList.get('queuesData').then(data => {
            const queuesdata = (data) ? JSON.parse(data) : {} 
            Object.keys(queuesdata).forEach(queue => {
                queuesdata[queue].members = {}
                queuesdata[queue].callsList = {}
            })
            this.queues = new Proxy(queuesdata, {
                emitter: this.emitter,
                set: function(obj, prop, value) {
                    // console.log(value)
                    obj[prop] = value
                    this.emitter.emit('queuesChange', prop, value)
                    return true
                }
            })
        })
        

        this.ami = new AMI(params)
        this.ami.connect().then(() => {
            global.log.debug(`AMI Connected to host ${params.host}:${params.port}`)
            this.queueStatus()
            setTimeout(() => this.endpointStatus(), 5000)
            setTimeout(() => this.coreShowChannels(), 10000)
        })
        this.ami.on('disconnect', () =>  global.log.warn(`AMI Disconnected from host ${params.host}:${params.port}`))
        this.ami.on('reconnect', () =>  global.log.info(`AMI Reconnected to host ${params.host}:${params.port}`))
        this.ami.on('error', () =>  global.log.error(`AMI Connection error to host ${params.host}:${params.port}`))

        this.emitter.on('queuesChange', (queue, data) => this.io.to(queue).emit('queueChange', data))
        this.emitter.on('endpointChange', (endpoint, data) => {
            this.io.to(endpoint).emit('endpointChange', data)
        }) 

        // this.ami.on('event', console.log)

        if (global.env.AMI_LOG) this.ami.on('event', (event) =>  global.log.debug(event))
        this.ami.on('DeviceStateChange', (event) => this.handleDeviceStateChange(event))
        this.ami.on('CoreShowChannel', (event) => this.handleCoreShowChannel(event))
        this.ami.on('QueueMemberAdded', (event) => this.handleQueueMemberAdded(event))
        this.ami.on('QueueMemberRemoved', (event) => this.handleQueueMemberRemoved(event))
        this.ami.on('QueueParams', (event) => this.handleQueueParams(event))
        this.ami.on('QueueMember', (event) => this.handleQueueMember(event))
        this.ami.on('QueueMemberPause', (event) => this.handleQueueMemberPause(event))
        this.ami.on('AgentRingNoAnswer', (event) => this.handleRingNoAnswer(event))
        this.ami.on('QueueMemberStatus', (event) => this.handleQueueMemberStatus(event))
        this.ami.on('AgentConnect', (event) => this.handleAgentConnect(event))
        this.ami.on('AgentComplete', (event) => this.handleAgentComplete(event))
        this.ami.on('QueueEntry', (event) => this.handleQueueEntry(event))
        this.ami.on('QueueCallerJoin', (event) => this.handleQueueCallerJoin(event))
        this.ami.on('QueueCallerLeave', (event) => this.handleQueueCallerLeave(event))
        this.ami.on('DialBegin', (event) => this.handleDialBegin(event))
        this.ami.on('DialEnd', (event) => this.handleDialEnd(event))
        this.ami.on('Newstate', (event) => this.handleNewState(event))
        this.ami.on('Newchannel', (event) => this.handleNewChannel(event))
        this.ami.on('NewConnectedLine', (event) => this.handleNewConnectedLine(event))
        this.ami.on('Hangup', (event) => this.handleHangup(event))
    }

    handleDeviceStateChange(event) { 
        try {
            const {device} = event
            const deviceType = device.split('/')[0].toUpperCase()

            if (["PJSIP", "KHOMP"].includes(deviceType)){
                const state = event.state.split('_').join('').toUpperCase()
                const stateDate = new Date() 
                
                const endpointdata = this.endpoints[device] || {outCalls: 0, inCalls: 0, missCalls: 0}
                const lastStateDate = new Date(endpointdata.lastStateDate)
        
                if (lastStateDate.getDay() !== stateDate.getDay()) {
                    endpointdata.outCalls = 0
                    endpointdata.inCalls = 0
                    endpointdata.missCalls = 0
                }
        
                switch (endpointdata.lastState) {
                    case 'NOTINUSE':
                        if (state === "INUSE") {
                            endpointdata.outCalls++
                            endpointdata.callType = "OUT"
                        }
                        break;
                    case 'DIALING':
                        if (state === "INUSE") {
                            endpointdata.outCalls++
                            endpointdata.callType = "OUT"
                        }
                        break;
                    case 'RINGING':
                        if (state === "INUSE") endpointdata.inCalls++
                        if (state === "NOTINUSE") endpointdata.missCalls++
                        break;
                
                    default:
                        break;
                }
        
                if (state === "RINGING") endpointdata.callType = "IN"
                if (endpointdata.lastState !== 'OFFHOOK') {
                    endpointdata.lastState = state 
                    endpointdata.lastStateDate = stateDate
                }
        
                this.endpoints[device] = endpointdata
            }  
        } catch (error) {
            
        }
    }

    handleQueueMemberAdded(event) {
        const {queue, membername, paused, callstaken, pausedreason, incall, status, interface: interfc} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}

        queuedata.members[interfc] = {
            membername, 
            interface: interfc, 
            queue, 
            paused, 
            CallsTaken: parseInt(callstaken), 
            PausedReason: pausedreason, 
            inCall: (status === '2'), 
            inQueueCall: parseInt(incall), 
            outCalls: 0, 
            unavail: (status === '5'), 
            activateCall: null, 
            callDuration: null
        }

        this.queues[queue] = queuedata

        const endpointdata = this.endpoints[interfc] || {}
        if (!endpointdata.queues) endpointdata.queues = {}

        endpointdata.queues[queue] = membername
        endpointdata.paused = paused
        endpointdata.PausedReason = pausedreason

        this.endpoints[interfc] = endpointdata
    }

    handleQueueMemberRemoved(event) {
        const {queue, interface: interfc} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}

        delete queuedata.members[interfc] 

        this.queues[queue] = queuedata

        const endpointdata = this.endpoints[interfc] || {}
        if (!endpointdata.queues) endpointdata.queues = {}

        delete endpointdata.queues[queue]  
        endpointdata.paused = false
        endpointdata.PausedReason = false

        this.endpoints[interfc] = endpointdata
    }

    handleQueueParams(event) {
        const {queue, calls, holdtime, talktime, completed, abandoned} = event

        let queuedata = this.queues[queue] || {}
        if (!queuedata.callsList) queuedata.callsList = {}
        if (!queuedata.members) queuedata.members = {}

        queuedata = {...queuedata, queue, calls, holdtime, talktime, completed, abandoned}

        this.queues[queue] = queuedata
    }

    handleQueueMember(event) {
        const {queue, name, paused, callstaken, pausedreason, incall, status, location, lastpause, logintime} = event
        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}
        queuedata.members[location] = {
            membername: name, 
            interface: location, 
            queue, 
            paused, 
            CallsTaken: parseInt(callstaken), 
            pauseStart: parseInt(lastpause)*1000, 
            PausedReason: pausedreason, 
            inCall: (status === '2'), 
            inQueueCall: parseInt(incall), 
            outCalls: (queuedata.members[location]) ? queuedata.members[location].outCalls : 0, 
            unavail: (status === '5'),
            activateCall: null, 
            callDuration: null,
            loginTime: parseInt(logintime)*1000,
            noAnsewerd: (queuedata.members[location]) ? queuedata.members[location].noAnsewerd : 0,
        }

        this.queues[queue] = queuedata

        if (global.env.NODE_ENV === 'production') {
            global.log.debug(`Adding interface: ${location} on queue: ${queue} to InterfaceQueue in Asterisk DB`)
            this.dbPut(location, queue, 'InterfaceQueue')
        }

        const endpointdata = this.endpoints[location] || {}
        if (!endpointdata.queues) endpointdata.queues = {}

        endpointdata.queues[queue] = name
        endpointdata.paused = paused
        endpointdata.pauseStart = parseInt(lastpause)*1000
        endpointdata.PausedReason = pausedreason

        this.endpoints[location] = endpointdata
    }

    handleQueueMemberStatus(event) {
        const {queue, membername, paused, callstaken, pausedreason, incall, status, interface: location, lastpause, logintime} = event
        
        const endpointdata = this.endpoints[location] || {}
        const queuedata = this.queues[queue] || {}
        
        if (!queuedata.members) queuedata.members = {}
        
        queuedata.members[location] = {
            membername, 
            interface: location, 
            queue, 
            paused, 
            CallsTaken: parseInt(callstaken), 
            pauseStart: parseInt(lastpause)*1000, 
            PausedReason: pausedreason, 
            inCall: (status === '2'), 
            inQueueCall: parseInt(incall), 
            outCalls: (queuedata.members[location]) ? queuedata.members[location].outCalls : 0, 
            unavail: (status === '5'),
            activateCall: null, 
            callDuration: null,
            loginTime: parseInt(logintime)*1000,
            noAnsewerd: (queuedata.members[location]) ? queuedata.members[location].noAnsewerd : 0,
        }
        
        if (endpointdata.callStart) queuedata.members[location].callStart = endpointdata.callStart
        if (endpointdata.connectNum) queuedata.members[location].calleridnum = endpointdata.connectNum

        if (!endpointdata.queues) endpointdata.queues = {}
        
        endpointdata.queues[queue] = membername
        endpointdata.paused = paused
        endpointdata.pauseStart = parseInt(lastpause)*1000
        endpointdata.PausedReason = pausedreason

        this.dbPut(location, queue, 'InterfaceQueue')
        
        this.queues[queue] = queuedata
        this.endpoints[location] = endpointdata
    }

    handleAgentComplete(event) {
        const {queue, holdtime, talktime} = event
        
        let queuedata = this.queues[queue] || {}
        
        queuedata = {...queuedata, queue, holdtime, talktime}
        
        this.queues[queue] = queuedata
    }

    async handleAgentConnect(event) {
        const {queue, interface: location, calleridnum, calleridname} = event
        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}

        let connectedClient

        if (calleridnum >= 8) {
            const infos = await this.clientModel.getClientInfo(calleridnum)
            connectedClient = infos[0] || undefined
        }

        queuedata.members[location] = {
            ...queuedata.members[location],
            inQueueCall: 1,
            calleridnum: (calleridnum !== 'unknown') ? calleridnum : "Desconhecido",
            calleridname: (calleridname !== 'unknown') ? calleridnum : "Desconhecido",
            callStart: new Date() - 0 * 1000,
            connectedClient: connectedClient
        }

        this.queues[queue] = queuedata
    }

    handleQueueMemberPause(event) {
        const {queue, paused, pausedreason, interface: interfc, membername, lastpause} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}

        queuedata.members[interfc] = {
            ...queuedata.members[interfc],
            paused, 
            PausedReason: pausedreason, 
            pauseStart: parseInt(lastpause)*1000, 
        }

        this.queues[queue] = queuedata

        const endpointdata = this.endpoints[interfc] || {}
        if (!endpointdata.queues) endpointdata.queues = {}

        endpointdata.queues[queue] = membername
        endpointdata.paused = paused
        endpointdata.PausedReason = pausedreason
        endpointdata.pauseStart = parseInt(lastpause)*1000

        this.endpoints[interfc] = endpointdata
    }

    handleRingNoAnswer(event) {
        const {queue, interface: interfc} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.members) queuedata.members = {}

        queuedata.members[interfc] = {
            ...queuedata.members[interfc],
            noAnsewerd: (queuedata.members[interfc]) ? queuedata.members[interfc].noAnsewerd +1 : 1
        }

        this.queues[queue] = queuedata
    }

    async handleQueueEntry(event) {
        const {queue, position, channel, uniqueid, calleridnum, calleridname, wait} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.callsList) queuedata.callsList = {}

        let client

        if (calleridnum >= 8) {
            const infos = await this.clientModel.getClientInfo(calleridnum)
            client = infos[0] || undefined
        }
        
        queuedata.callsList[channel] = {
            queue,
            channel,
            initialposition: (queuedata.callsList[channel]) ? queuedata.callsList[channel].initialposition : position,
            position,
            uniqueid,
            calleridnum: (calleridnum !== 'unknown') ? calleridnum : "Desconhecido",
            calleridname: (calleridname !== 'unknown') ? calleridnum : "Desconhecido",
            wait,
            callStart: new Date() - parseInt(wait) * 1000,
            client
        }

        this.queues[queue] = queuedata
    }

    async handleQueueCallerJoin(event) {
        const {queue, position, channel, uniqueid, calleridnum, calleridname, wait} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.callsList) queuedata.callsList = {}

        queuedata.calls = `${parseInt(queuedata.calls) + 1}`

        let client

        if (calleridnum >= 8) {
            const infos = await this.clientModel.getClientInfo(calleridnum)
            client = infos[0] || undefined
        }

        queuedata.callsList[channel] = {
            queue,
            channel,
            initialposition: (queuedata.callsList[channel]) ? queuedata.callsList[channel].initialposition : position,
            position,
            uniqueid,
            calleridnum: (calleridnum !== 'unknown') ? calleridnum : "Desconhecido",
            calleridname: (calleridname !== 'unknown') ? calleridnum : "Desconhecido",
            wait,
            callStart: new Date() - 0 * 1000,
            client
        }

        this.queues[queue] = queuedata
    }

    handleQueueCallerLeave(event) {
        const {queue, channel} = event

        const queuedata = this.queues[queue] || {}
        if (!queuedata.callsList) queuedata.callsList = {}

        queuedata.calls = `${parseInt(queuedata.calls) - 1}`

        delete queuedata.callsList[channel]

        Object.values(queuedata.callsList).forEach((call, index) => {
            queuedata.callsList[call.channel] = {
                ...call, 
                position: index + 1
            }
        })

        this.queues[queue] = queuedata
        this.queueStatus(queue)
    }

    handleDialBegin(event) {
        const {destexten, channel, uniqueid} = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')

        const endpointdata = this.endpoints[endpoint] || {}

        endpointdata.lastState = "DIALING"
        endpointdata.activeChannel = channel
        endpointdata.connectNum = destexten
        endpointdata.callType = "OUT"
        endpointdata.callStart = new Date().getTime() 

        if (!endpointdata.queues) endpointdata.queues = {}

        if (Object.keys(endpointdata.queues).length) {
            const queue = Object.keys(endpointdata.queues)[0]
            const interfc = endpointdata.queues[queue]
            const queuedata = this.queues[queue] || {}
            if (!queuedata.members) queuedata.members = {}
            if (!queuedata.members[endpoint]) queuedata.members[endpoint] = {outCalls: 0}
            
            queuedata.outCalls++
            queuedata.members[endpoint].outCalls++

            // if (global.env.NODE_ENV === 'production') {
            //     global.log.debug(`New queue_log event: ${queue}, OUTGOINGCALLSTART, ${uniqueid}, ${interfc}, ${destexten}`)
            //     this.addQueuelogEvent(queue, 'OUTGOINGCALLSTART', uniqueid, interfc, `${destexten}`)
            // }
            this.queues[queue] = queuedata
        }

        this.endpoints[endpoint] = endpointdata
    }

    handleDialEnd(event) {
        const {connectedlinenum, channel, destchannel, dialstatus} = event
        const chan = channel || destchannel
        const endpoint = `${chan || ''}`.replace(/-.*/, '')

        const endpointdata = this.endpoints[endpoint] || {}

        endpointdata.lastState = (dialstatus === 'ANSWER') ? "INUSE" : "NOTINUSE"
        endpointdata.activeChannel = chan
        endpointdata.connectNum = connectedlinenum
        endpointdata.callType = "OUT"
        endpointdata.dialstatus = dialstatus
        endpointdata.dialEndTime = new Date().getTime()

        this.endpoints[endpoint] = endpointdata
    }

    handleNewState(event) {
        const {channel, context, exten, channelstatedesc } = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')
        const deviceType = endpoint.split('/')[0].toUpperCase()

        const start = new Date().getTime()
        let update = false

        const endpointdata = this.endpoints[endpoint] || {}
        if (channelstatedesc === 'Ring' && deviceType === 'KHOMP') {
            endpointdata.callStart =  start
            endpointdata.lastState = 'DIALING'
            endpointdata.lastStateDate = new Date()
            update = true
    
        } else if (channelstatedesc === 'Up' && deviceType !== 'KHOMP') {
            const endpointdata = this.endpoints[endpoint] || {}
            endpointdata.callStart = start
            update = true
        }

        if (update) this.endpoints[endpoint] = endpointdata

    }

    handleNewChannel(event) {
        const {channel, context, exten, channelstatedesc } = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')
        const deviceType = endpoint.split('/')[0].toUpperCase()

        const endpointdata = this.endpoints[endpoint] || {}

        if (channelstatedesc === 'Ring') {
            endpointdata.callStart = new Date().getTime() 
            if (context === 'sainte') {
                endpointdata.activeChannel = channel
                endpointdata.connectNum = exten
            }
        } else if (deviceType === "KHOMP" && channelstatedesc === 'Pre-ring' ) {
            endpointdata.lastState = 'OFFHOOK'
            endpointdata.lastStateDate = new Date()
        }
        
        this.endpoints[endpoint] = endpointdata
    }

    async handleNewConnectedLine(event) {
        const {connectedlinenum, channel} = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')

        const endpointdata = this.endpoints[endpoint] || {}

        endpointdata.activeChannel = channel
        endpointdata.connectedlinenum = connectedlinenum

        if (connectedlinenum >= 8) {
            endpointdata.connectedClient = await this.clientModel.getClientInfo(connectedlinenum)
        } else {
            endpointdata.connectedClient = []
        }

        this.endpoints[endpoint] = endpointdata
    }

    handleCoreShowChannel(event) {
        const {connectedlinenum, channel, duration, connectedlinename} = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')
        const [hours, minutes, seconds] = duration?.split(':') || [0, 0, 0] 
        const callStart = new Date() - ((+hours) * 60 * 60 + (+minutes) * 60 + (+seconds)) * 1000

        const endpointdata = this.endpoints[endpoint] || {}
        endpointdata.activeChannel = channel
        endpointdata.connectNum = connectedlinenum
        endpointdata.callStart = callStart

        this.endpoints[endpoint] = endpointdata

        Object.values(this.queues).forEach(queue => {
            const queueData = queue

            if (queueData.members[endpoint]) queueData.members[endpoint] = {
                ...queueData.members[endpoint],
                calleridnum: (connectedlinenum !== '<unknown>') ? connectedlinenum : "Desconhecido",
                calleridname: (connectedlinename !== '<unknown>') ? connectedlinename : "Desconhecido",
                callStart: callStart
            }
        })
    }

    handleHangup(event) {
        const {channel, uniqueid} = event
        const endpoint = `${channel || ''}`.replace(/-.*/, '')
        const deviceType = endpoint.split('/')[0].toUpperCase()


        const endpointdata = this.endpoints[endpoint] || {}

        if (!endpointdata.queues) endpointdata.queues = {}

        if (deviceType === "KHOMP" && endpointdata.lastState === 'OFFHOOK' ) {
            endpointdata.lastState = 'NOTINUSE'
            endpointdata.lastStateDate = new Date()
        }
        
        if (Object.keys(endpointdata.queues).length && endpointdata.callType === 'OUT') {
            const {dialstatus, callStart, dialEndTime} = endpointdata
            const queue = Object.keys(endpointdata.queues)[0]
            const interfc = endpointdata.queues[queue]
            const talkTime = (dialstatus === "ANSWER") ?  new Date().getTime() / 1000 - dialEndTime / 1000: 0
            const holdtime = parseInt(`${dialEndTime || 0}`) / 1000 - parseInt(`${callStart || 0}`) / 1000

            // if (global.env.NODE_ENV === 'production') {
            //     if (dialstatus) {
            //         global.log.debug(`New queue_log event: ${queue}, OUTGOINGCALLEND, ${uniqueid}, ${interfc}, ${dialstatus}|${Math.round(holdtime)}|${Math.round(talkTime)}`)
            //         this.addQueuelogEvent(
            //             queue, 
            //             'OUTGOINGCALLEND', 
            //             uniqueid, 
            //             interfc, 
            //             `${dialstatus}|${Math.round(holdtime)}|${Math.round(talkTime)}`
            //         )
            //     } else {
            //         global.log.warn(`Missing dial status: [ ${JSON.stringify(event)}, ${JSON.stringify(endpointdata)} ]`)
            //     }
            // }
        }

        this.endpoints[endpoint] = endpointdata
    }

    async originate(dest, endpoint, callid, first_peer = 'local') {
        const action = (first_peer === 'local') ? {
            action: 'Originate', 
            actionid: callid,
            Channel: endpoint.channel, 
            Variable: `company_id=${endpoint.company_id},originate_id=${callid}`,
            Context: "sainte",
            Priority: 1,
            Exten: dest,
            Callerid: `${endpoint.name}<${endpoint.id}>`
        } : {
            action: 'Originate', 
            actionid: callid,
            Channel: `Local/${dest}@sainte`, 
            Variable: `company_id=${endpoint.company_id},originate_id=${callid}`,
            Context: "sainte",
            Priority: 1,
            Exten: endpoint.id,
            Callerid: `<${dest}>`
        }
        const response = await this.ami.send(action)
        return response
    }

    async hangup(channel) {
        return await this.ami.send({
            action: 'Hangup', 
            channel: channel
        })
    }

    async queueAdd(queue, endpoint, memberName){
        const response = await this.ami.send({action: 'QueueAdd', Queue: queue, Interface: endpoint, MemberName: memberName})
        return response
    }

    async queueRemove(queue, endpoint){
        const response = await this.ami.send({action: 'QueueRemove', Queue: queue, Interface: endpoint})
        return response
    }

    async queuePause(paused, pause_id, endpoint){ 
        const response = await this.ami.send({action: 'QueuePause', Paused: paused, Reason: pause_id || '' , Interface: endpoint})
        return response
    }

    endpointQueuesRemove(endpoint) {
        const queues = (this.endpoints[endpoint]) ? Object.keys(this.endpoints[endpoint].queues) : []
        queues.forEach(queue => this.ami.send({action: 'QueueRemove', Queue: queue, Interface: endpoint}))
    }

    queueStatus(queue){
        const action = {Action: 'QueueStatus'}
        if(queue) action.queue = queue
        this.ami.send(action)
    }

    endpointStatus(){
        this.ami.send({Action: 'DeviceStateList'})
    }

    coreShowChannels(){
        this.ami.send({Action: 'coreShowChannels'})
    }

    async forward(channel, exten){
        return this.ami.send({Action: 'Redirect', Channel: channel, Exten: exten, Context: 'sainte', Priority: '1'})
    }

    async transfer(channel, exten){
        return this.ami.send({Action: 'BlindTransfer', Channel: channel, Exten: exten, Context: 'sainte', Priority: '1'})
    }

    dialplanReload(){
        this.ami.send({Action: 'Command', Command: 'dialplan reload'})
    }

    async Command(command){
        const response = await this.ami.send({Action: 'Command', Command: command})
        return response
    }

    getEndpointStatus(endpoint) {
        return this.endpoints[endpoint]
    }

    getEndpointsStatus() {
        return this.endpoints
    }

    getInterfaceQueues(endpoint) {
        return this.endpoints[endpoint].queues
    }

    getQueueStatus(queue) {
        return this.queues[queue]
    }

    getQueuesStatus() {
        return this.queues
    }

    async updateChanspy(endpoint, channel, enable) {
        await this.dbPut((enable) ? 1 : 0, `${endpoint}/MONITORAMENTO`, 'RAMAIS')

        const endpointdata = this.endpoints[channel] || {}

        endpointdata.chanspy = (enable) ? 1 : 0

        if (Object.keys(endpointdata.queues).length) {
            const queues = Object.keys(endpointdata.queues)

            queues.forEach(queue => {
                const queuedata = this.queues[queue] || {}
                if (!queuedata.members) queuedata.members = {}
                if (!queuedata.members[channel]) queuedata.members[channel] = {}
                queuedata.members[channel].chanspy = (enable) ? 1 : 0

                this.queues[queue] = queuedata
            })
        }

        this.endpoints[channel] = endpointdata

        return true
    }

    async queueRemoveAll(){
        this.ami.send({Action: 'QueueStatus'}, (err, qs) => {
            if (!err) {
                qs.eventlist?.forEach(e => {
                    const {event, queue, location} = e
                    if (event === 'QueueMember') this.queueRemove(queue, location)
                })

                global.log.debug(`Removing all interfaces from loggedAgents in Asterisk DB`)
                this.DBDelTree('loggedAgents')
                global.log.debug(`Removing all interfaces from InterfaceQueue in Asterisk DB`)
                this.DBDelTree('InterfaceQueue')
            }
        })

        return true
    }

    async dbPut(key, val, family = 'Global'){
        const response = await this.ami.send({Action: 'DBPut', Family: family, Key: key, Val: val})
        return response
    }

    async dbDel(key, family = 'Global'){
        const response = await this.ami.send({Action: 'DBDel', Family: family, Key: key})
        return response
    }

    async DBDelTree(family){
        const response = await this.ami.send({Action: 'DBDelTree', Family: family})
        return response
    }

    addQueuelogEvent(queue, event, uniqueid = '', interfc = '', message = ''){
        this.ami.send({
            Action: 'QueueLog', 
            Queue: queue, 
            Event: event, 
            Uniqueid: uniqueid, 
            Interface: interfc,
            Message: message
        })
    }
}

module.exports =  Ami