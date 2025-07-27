import React from 'react';
import { Button, Icon } from 'semantic-ui-react';
import { Socket } from 'socket.io-client';

import {
  formatTimestamp,
  getOrCreateClientId,
  getColorForStringHex,
  getDefaultPicture,
  iceServers,
} from '../../utils';
import { UserMenu } from '../UserMenu/UserMenu';
import firebase from 'firebase/compat/app';
import { MetadataContext } from '../../MetadataContext';

interface VideoChatProps {
  socket: Socket;
  participants: User[];
  pictureMap: StringDict;
  nameMap: StringDict;
  tsMap: NumberDict;
  rosterUpdateTS: Number;
  hide?: boolean;
  owner: string | undefined;
  getLeaderTime: () => number;
}

export class VideoChat extends React.Component<VideoChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  socket = this.props.socket;

  componentDidMount() {
    this.socket.on('signal', this.handleSignal);
  }

  componentWillUnmount() {
    this.socket.off('signal', this.handleSignal);
  }

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }
  }

  emitUserMute = () => {
    this.socket.emit('CMD:userMute', { isMuted: !this.getAudioWebRTC() });
  };

  handleSignal = async (data: any) => {
    // Handle messages received from signaling server
    const msg = data.msg;
    const from = data.from;
    const pc = window.watchparty.videoPCs[from];
    console.log('recv', from, data);
    if (msg.ice !== undefined) {
      pc.addIceCandidate(new RTCIceCandidate(msg.ice));
    } else if (msg.sdp && msg.sdp.type === 'offer') {
      // console.log('offer');
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { sdp: pc.localDescription });
    } else if (msg.sdp && msg.sdp.type === 'answer') {
      pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
  };

  setupWebRTC = async () => {
    // Set up our own audio stream
    let stream = new MediaStream();

    try {
      // Request audio only
      stream = await navigator?.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (e) {
      console.warn(e);
      // If audio fails, create empty stream
      stream = new MediaStream();
    }
    window.watchparty.ourStream = stream;

    // alert server we've joined audio chat
    this.socket.emit('CMD:joinVideo');
    this.emitUserMute();
  };

  stopWebRTC = () => {
    console.log('Stopping WebRTC audio chat...');
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    const videoRefs = window.watchparty.videoRefs;

    // Stop all tracks
    ourStream &&
      ourStream.getTracks().forEach((track) => {
        console.log('Stopping track:', track);
        track.stop();
      });

    // Clear the global stream reference
    window.watchparty.ourStream = undefined;

    // Close and remove all peer connections
    Object.keys(videoPCs).forEach((key) => {
      console.log('Closing peer connection:', key);
      videoPCs[key].close();
      delete videoPCs[key];
    });

    // Clear all video/audio element references
    Object.keys(videoRefs).forEach((key) => {
      if (videoRefs[key]) {
        videoRefs[key].srcObject = null;
      }
    });

    // Notify server we're leaving
    this.socket.emit('CMD:leaveVideo');

    console.log('WebRTC cleanup complete');

    // Force component to re-render to reflect the change
    this.forceUpdate();
  };

  toggleAudioWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    if (ourStream && ourStream.getAudioTracks()[0]) {
      ourStream.getAudioTracks()[0].enabled =
        !ourStream.getAudioTracks()[0]?.enabled;
    }
    this.emitUserMute();
    this.forceUpdate();
  };

  getAudioWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    return (
      ourStream &&
      ourStream.getAudioTracks()[0] &&
      ourStream.getAudioTracks()[0].enabled
    );
  };

  updateWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    const videoRefs = window.watchparty.videoRefs;
    if (!ourStream) {
      // We haven't started audio chat, exit
      return;
    }
    const selfId = getOrCreateClientId();

    // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
    // This allows them to rejoin later
    const clientIds = new Set(
      this.props.participants
        .filter((p) => p.isVideoChat)
        .map((p) => p.clientId),
    );
    Object.entries(videoPCs).forEach(([key, value]) => {
      if (!clientIds.has(key)) {
        value.close();
        delete videoPCs[key];
      }
    });

    this.props.participants.forEach((user) => {
      const id = user.clientId;
      if (!user.isVideoChat || videoPCs[id]) {
        // User isn't in audio chat, or we already have a connection to them
        return;
      }
      if (id === selfId) {
        videoPCs[id] = new RTCPeerConnection();
        // For audio-only, we'll use a hidden audio element
        const element = videoRefs[id];
        if (element && element.tagName === 'AUDIO') {
          (element as HTMLAudioElement).srcObject = ourStream;
        }
      } else {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        videoPCs[id] = pc;
        // Add our own audio as outgoing stream
        ourStream?.getTracks().forEach((track) => {
          if (ourStream) {
            pc.addTrack(track, ourStream);
          }
        });
        pc.onicecandidate = (event) => {
          // We generated an ICE candidate, send it to peer
          if (event.candidate) {
            this.sendSignal(id, { ice: event.candidate });
          }
        };
        pc.ontrack = (event: RTCTrackEvent) => {
          // Mount the stream from peer
          const element = videoRefs[id];
          if (element && element.tagName === 'AUDIO') {
            (element as HTMLAudioElement).srcObject = event.streams[0];
          }
        };
        // For each pair, have the lexicographically smaller ID be the offerer
        const isOfferer = selfId < id;
        if (isOfferer) {
          pc.onnegotiationneeded = async () => {
            // Start connection for peer's audio
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { sdp: pc.localDescription });
          };
        }
      }
    });
  };

  sendSignal = async (to: string, data: any) => {
    console.log('send', to, data);
    this.socket.emit('signal', { to, msg: data });
  };

  render() {
    const { participants, pictureMap, nameMap, tsMap, socket, owner } =
      this.props;
    const ourStream = window.watchparty.ourStream;
    const videoRefs = window.watchparty.videoRefs;
    const audioChatContentStyle = {
      height: participants.length <= 3 ? 200 : 100,
      borderRadius: '4px',
      objectFit: 'cover' as any,
      border: '2px solid #555',
    };
    const selfId = getOrCreateClientId();
    return (
      <div
        style={{
          display: this.props.hide ? 'none' : 'flex',
          width: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          margin: '4px',
        }}
      >
        {!ourStream && (
          <Button
            color={'purple'}
            size="medium"
            icon
            labelPosition="left"
            onClick={this.setupWebRTC}
          >
            <Icon name="microphone" />
            {`Join Audio Chat`}
          </Button>
        )}
        {ourStream && (
          <Button
            color={'red'}
            size="medium"
            icon
            labelPosition="left"
            onClick={this.stopWebRTC}
          >
            <Icon name="external" />
            {`Leave`}
          </Button>
        )}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {ourStream && (
            <Button
              color={this.getAudioWebRTC() ? 'green' : 'red'}
              size="medium"
              icon
              labelPosition="left"
              onClick={this.toggleAudioWebRTC}
            >
              <Icon
                name={this.getAudioWebRTC() ? 'microphone' : 'microphone slash'}
              />
              {this.getAudioWebRTC() ? 'On' : 'Off'}
            </Button>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          {participants.map((p) => {
            return (
              <div key={p.id}>
                <div
                  style={{
                    position: 'relative',
                  }}
                >
                  <div>
                    <UserMenu
                      displayName={nameMap[p.id] || p.id}
                      disabled={
                        !Boolean(owner && owner === this.context.user?.uid)
                      }
                      position={'left center'}
                      socket={socket}
                      userToManage={p.id}
                      trigger={
                        <Icon
                          name="ellipsis vertical"
                          size="large"
                          style={{
                            position: 'absolute',
                            right: -7,
                            top: 5,
                            cursor: 'pointer',
                            opacity: 0.75,
                            visibility: Boolean(
                              owner && owner === this.context.user?.uid,
                            )
                              ? 'visible'
                              : 'hidden',
                          }}
                        />
                      }
                    />
                    {ourStream && p.isVideoChat ? (
                      <div style={{ position: 'relative' }}>
                        <audio
                          ref={(el) => {
                            if (el) {
                              videoRefs[p.clientId] = el;
                            }
                          }}
                          autoPlay
                          muted={p.clientId === selfId}
                          data-id={p.id}
                        />
                        <img
                          style={{
                            ...audioChatContentStyle,
                            filter: p.isMuted ? 'grayscale(100%)' : 'none',
                          }}
                          src={
                            pictureMap[p.id] ||
                            getDefaultPicture(
                              nameMap[p.id],
                              getColorForStringHex(p.id),
                            )
                          }
                          alt=""
                        />
                      </div>
                    ) : (
                      <img
                        style={audioChatContentStyle}
                        src={
                          pictureMap[p.id] ||
                          getDefaultPicture(
                            nameMap[p.id],
                            getColorForStringHex(p.id),
                          )
                        }
                        alt=""
                      />
                    )}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: '0px',
                        width: '100%',
                        backgroundColor: 'rgba(0,0,0,0)',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 700,
                        display: 'flex',
                      }}
                    >
                      <div
                        title={nameMap[p.id] || p.id}
                        style={{
                          width: '80px',
                          backdropFilter: 'brightness(80%)',
                          padding: '4px',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          display: 'inline-block',
                        }}
                      >
                        {p.isScreenShare && (
                          <Icon size="small" name="slideshare" />
                        )}
                        {p.isVideoChat && (
                          <Icon size="small" name="microphone" />
                        )}
                        {p.isMuted && (
                          <Icon
                            size="large"
                            name="microphone slash"
                            color="red"
                          />
                        )}
                        {nameMap[p.id] || p.id}
                      </div>
                      <div
                        style={{
                          backdropFilter: 'brightness(60%)',
                          padding: '4px',
                          flexGrow: 1,
                          display: 'flex',
                          justifyContent: 'center',
                        }}
                      >
                        {formatTimestamp(tsMap[p.id] || 0)}{' '}
                        {this.context.beta &&
                          `(${(
                            (tsMap[p.id] - this.props.getLeaderTime()) *
                            1000
                          ).toFixed(0)}ms)`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
