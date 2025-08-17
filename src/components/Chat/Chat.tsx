import React, { RefObject, useContext } from 'react';
import { Button, Comment, Form, Icon, Input, Popup } from 'semantic-ui-react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { init } from 'emoji-mart';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
// import onClickOutside from 'react-onclickoutside';
//@ts-ignore
import Linkify from 'react-linkify';
import { SecureLink } from 'react-secure-link';
import styles from './Chat.module.css';
import Markdown from 'react-markdown';

import {
  formatTimestamp,
  getColorForStringHex,
  getDefaultPicture,
  isEmojiString,
} from '../../utils';
import { Separator } from '../App/App';
import { UserMenu } from '../UserMenu/UserMenu';
import { Socket } from 'socket.io-client';
import firebase from 'firebase/compat/app';
import classes from './Chat.module.css';
import {
  CSSTransition,
  SwitchTransition,
  TransitionGroup,
} from 'react-transition-group';
import { MetadataContext } from '../../MetadataContext';

// TODO: Replace with your Giphy API key
const gf = new GiphyFetch('hfQQXlmO9MOs2uCMA4WPD2kf84KSAJnm');

interface ChatProps {
  chat: ChatMessage[];
  nameMap: StringDict;
  pictureMap: StringDict;
  socket: Socket;
  scrollTimestamp: number;
  className?: string;
  getMediaDisplayName: (input: string) => string;
  hide?: boolean;
  isChatDisabled?: boolean;
  owner: string | undefined;
  ref: RefObject<Chat>;
  isLiveStream: boolean;
  // Audio chat props
  participants: User[];
  tsMap: NumberDict;
  setupWebRTC?: () => void;
  stopWebRTC?: () => void;
  getAudioWebRTC?: () => boolean;
  toggleAudioWebRTC?: () => void;
}

export class Chat extends React.Component<ChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = {
    chatMsg: '',
    isNearBottom: true,
    isPickerOpen: false,
    isGifPickerOpen: false,
    gifSearchQuery: '',
    reactionMenu: {
      isOpen: false,
      selectedMsgId: '',
      selectedMsgTimestamp: '',
      yPosition: 0,
      xPosition: 0,
    },
    participantGridScrollLeft: 0,
    showLeftArrow: false,
    showRightArrow: false,
    isParticipantGridCollapsed: false,
  };
  messagesRef = React.createRef<HTMLDivElement>();
  participantGridRef = React.createRef<HTMLDivElement>();

  async componentDidMount() {
    this.scrollToBottom();
    this.messagesRef.current?.addEventListener('scroll', this.onScroll);
    init({ data });
    // Check scroll arrows after initial render
    setTimeout(() => this.updateScrollArrows(), 200);
  }

  componentDidUpdate(prevProps: ChatProps) {
    if (this.props.scrollTimestamp !== prevProps.scrollTimestamp) {
      if (prevProps.scrollTimestamp === 0 || this.state.isNearBottom) {
        this.scrollToBottom();
        this.scrollToBottomWithImageLoad();
      }
    }
    if (this.props.hide !== prevProps.hide) {
      this.scrollToBottom();
    }

    // Update scroll arrows when participants change
    if (prevProps.participants !== this.props.participants) {
      setTimeout(() => this.updateScrollArrows(), 100);
    }
  }

  setReactionMenu = (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => {
    this.setState({
      reactionMenu: {
        isOpen,
        selectedMsgId,
        selectedMsgTimestamp,
        yPosition,
        xPosition,
      },
    });
  };

  handleReactionClick = (value: string, id?: string, timestamp?: string) => {
    const msg = this.props.chat.find(
      (m) => m.id === id && m.timestamp === timestamp,
    );
    const data = {
      value,
      msgId: id || this.state.reactionMenu.selectedMsgId,
      msgTimestamp: timestamp || this.state.reactionMenu.selectedMsgTimestamp,
    };
    if (msg?.reactions?.[value].includes(this.props.socket.id)) {
      this.props.socket.emit('CMD:removeReaction', data);
    } else {
      this.props.socket.emit('CMD:addReaction', data);
    }
  };

  updateChatMsg = (_e: any, data: { value: string }) => {
    // console.log(e.target.selectionStart);
    this.setState({ chatMsg: data.value });
  };

  sendChatMsg = () => {
    if (!this.state.chatMsg) {
      return;
    }
    if (this.chatTooLong()) {
      return;
    }
    this.setState({ chatMsg: '' });
    this.props.socket.emit('CMD:chat', this.state.chatMsg);
  };

  chatTooLong = () => {
    return Boolean(this.state.chatMsg?.length > 10000);
  };

  onScroll = () => {
    this.setState({ isNearBottom: this.isChatNearBottom() });
  };

  isChatNearBottom = () => {
    return (
      this.messagesRef.current &&
      this.messagesRef.current.scrollHeight -
        this.messagesRef.current.scrollTop -
        this.messagesRef.current.offsetHeight <
        50
    );
  };

  scrollToBottom = () => {
    if (this.messagesRef.current) {
      this.messagesRef.current.scrollTop =
        this.messagesRef.current.scrollHeight;
    }
  };

  scrollToBottomWithImageLoad = () => {
    if (!this.messagesRef.current) {
      return;
    }

    // First scroll immediately
    this.messagesRef.current.scrollTop = this.messagesRef.current.scrollHeight;

    // Get all images in the chat
    const images = this.messagesRef.current.querySelectorAll('img');

    if (images.length === 0) {
      // No images, we're done
      return;
    }

    let loadedCount = 0;
    const totalImages = images.length;
    let hasScrolledFinal = false;

    const performFinalScroll = () => {
      if (hasScrolledFinal || !this.messagesRef.current) {
        return;
      }
      hasScrolledFinal = true;

      // Use requestAnimationFrame for better timing
      requestAnimationFrame(() => {
        if (this.messagesRef.current) {
          this.messagesRef.current.scrollTop =
            this.messagesRef.current.scrollHeight;
        }
      });
    };

    const handleImageLoad = () => {
      loadedCount++;
      if (loadedCount >= totalImages) {
        performFinalScroll();
      }
    };

    // Set up a fallback timeout in case some images take too long
    const fallbackTimeout = setTimeout(() => {
      performFinalScroll();
    }, 2000); // 2 second fallback

    images.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        // Image is already loaded
        handleImageLoad();
      } else {
        // Set up one-time event listeners
        const onLoad = () => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          handleImageLoad();
        };

        const onError = () => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          handleImageLoad();
        };

        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
      }
    });

    // Clean up the fallback timeout if we complete normally
    if (loadedCount >= totalImages) {
      clearTimeout(fallbackTimeout);
      performFinalScroll();
    }
  };

  formatMessage = (cmd: string, msg: string): React.ReactNode | string => {
    if (cmd === 'host') {
      return (
        <React.Fragment>
          {`changed the video to `}
          <span style={{ textTransform: 'initial' }}>
            {this.props.getMediaDisplayName(msg)}
          </span>
        </React.Fragment>
      );
    } else if (cmd === 'playlistAdd') {
      return (
        <React.Fragment>
          {`added to the playlist: `}
          <span style={{ textTransform: 'initial' }}>
            {this.props.getMediaDisplayName(msg)}
          </span>
        </React.Fragment>
      );
    } else if (cmd === 'seek') {
      return `jumped to ${
        this.props.isLiveStream
          ? formatTimestamp(msg, true)
          : formatTimestamp(msg)
      }`;
    } else if (cmd === 'play') {
      return `started the video at ${formatTimestamp(msg)}`;
    } else if (cmd === 'pause') {
      return `paused the video at ${formatTimestamp(msg)}`;
    } else if (cmd === 'playbackRate') {
      return `set the playback rate to ${msg === '0' ? 'auto' : `${msg}x`}`;
    } else if (cmd === 'lock') {
      return `locked the room`;
    } else if (cmd === 'unlock') {
      return 'unlocked the room';
    } else if (cmd === 'vBrowserTimeout') {
      return (
        <React.Fragment>
          The VBrowser shut down automatically.
          <br />
          Subscribe for longer sessions.
        </React.Fragment>
      );
    } else if (cmd === 'vBrowserAlmostTimeout') {
      return (
        <React.Fragment>
          The VBrowser will shut down soon.
          <br />
          Subscribe for longer sessions.
        </React.Fragment>
      );
    }
    return cmd;
  };

  addEmoji = (emoji: any) => {
    this.setState({ chatMsg: this.state.chatMsg + emoji.native });
  };

  addGif = (gif: any) => {
    const gifMarkdown = `![${gif.title}](${gif.images.downsized.url})`;
    this.setState({ chatMsg: this.state.chatMsg + gifMarkdown });
  };

  updateGifSearchQuery = (_e: any, data: { value: string }) => {
    this.setState({ gifSearchQuery: data.value });
  };

  getAudioParticipants = () => {
    const { participants, tsMap } = this.props;
    // Filter participants who are in audio chat
    const audioParticipants = participants.filter((p) => p.isVideoChat);

    // Sort by most recent activity (timestamp) descending
    return audioParticipants.sort((a, b) => {
      const tsA = tsMap[a.id] || 0;
      const tsB = tsMap[b.id] || 0;
      return tsB - tsA;
    });
  };

  updateScrollArrows = () => {
    const grid = this.participantGridRef.current;
    if (!grid) return;

    const { scrollLeft, scrollWidth, clientWidth } = grid;
    const showLeftArrow = scrollLeft > 0;
    const showRightArrow = scrollLeft < scrollWidth - clientWidth - 1;

    this.setState({
      participantGridScrollLeft: scrollLeft,
      showLeftArrow,
      showRightArrow,
    });
  };

  handleParticipantGridScroll = () => {
    this.updateScrollArrows();
  };

  scrollParticipantGrid = (direction: 'left' | 'right') => {
    const grid = this.participantGridRef.current;
    if (!grid) return;

    const scrollAmount = 150; // Pixels to scroll
    const newScrollLeft =
      grid.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount);

    grid.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth',
    });
  };

  toggleParticipantGrid = () => {
    this.setState({
      isParticipantGridCollapsed: !this.state.isParticipantGridCollapsed,
    });
  };

  renderAudioChatSection = () => {
    const { setupWebRTC, stopWebRTC, getAudioWebRTC, toggleAudioWebRTC } =
      this.props;
    const audioParticipants = this.getAudioParticipants();
    const ourStream = (window as any).watchparty?.ourStream;
    const isInAudio = Boolean(ourStream);
    const isMuted = isInAudio && getAudioWebRTC && !getAudioWebRTC();

    return (
      <div className={styles.audioSection}>
        {/* Audio chat controls */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom:
              audioParticipants.length > 0 &&
              !this.state.isParticipantGridCollapsed
                ? '8px'
                : '0px',
            alignItems: 'center',
          }}
        >
          {!isInAudio ? (
            <>
              <Button
                color={audioParticipants.length > 0 ? 'green' : 'purple'}
                icon
                labelPosition="left"
                onClick={setupWebRTC}
                size="small"
                style={{ flex: 1 }}
              >
                <Icon name="microphone" />
                Join Audio Chat{' '}
                {audioParticipants.length > 0
                  ? `(${audioParticipants.length})`
                  : ''}
              </Button>
              {audioParticipants.length > 0 && (
                <Button
                  icon
                  size="small"
                  onClick={this.toggleParticipantGrid}
                  title={
                    this.state.isParticipantGridCollapsed
                      ? 'Show participants'
                      : 'Hide participants'
                  }
                  className={styles.collapseButton}
                >
                  <Icon
                    name={
                      this.state.isParticipantGridCollapsed
                        ? 'angle up'
                        : 'angle down'
                    }
                  />
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                color={isMuted ? 'red' : 'green'}
                icon
                onClick={toggleAudioWebRTC}
                size="medium"
                circular
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`${styles.micButton} ${isMuted ? styles.micButtonMuted : styles.micButtonUnmuted}`}
              >
                <Icon
                  name={isMuted ? 'microphone slash' : 'microphone'}
                  className={styles.micIcon}
                />
              </Button>
              <div
                style={{
                  flex: 1,
                  fontSize: '12px',
                  color: 'rgba(255, 255, 255, 0.7)',
                }}
              >
                In Audio Chat ({audioParticipants.length})
              </div>
              {audioParticipants.length > 0 && (
                <Button
                  icon
                  size="mini"
                  onClick={this.toggleParticipantGrid}
                  title={
                    this.state.isParticipantGridCollapsed
                      ? 'Show participants'
                      : 'Hide participants'
                  }
                  className={styles.collapseButton}
                >
                  <Icon
                    name={
                      this.state.isParticipantGridCollapsed
                        ? 'angle up'
                        : 'angle down'
                    }
                  />
                </Button>
              )}
              <Button
                color="red"
                size="mini"
                onClick={stopWebRTC}
                title="Leave Audio Chat"
              >
                Leave
              </Button>
            </>
          )}
        </div>

        {/* Horizontal scrolling participant grid with arrows */}
        {audioParticipants.length > 0 && (
          <div
            className={`${styles.participantGridContainer} ${
              this.state.isParticipantGridCollapsed
                ? styles.participantGridCollapsed
                : styles.participantGridExpanded
            }`}
            style={{ position: 'relative' }}
          >
            {/* Left arrow */}
            {this.state.showLeftArrow &&
              !this.state.isParticipantGridCollapsed && (
                <Button
                  circular
                  icon
                  size="mini"
                  onClick={() => this.scrollParticipantGrid('left')}
                  className={`${styles.scrollArrow} ${styles.scrollArrowLeft}`}
                  title="Scroll left"
                >
                  <Icon name="chevron left" />
                </Button>
              )}

            {/* Right arrow */}
            {this.state.showRightArrow &&
              !this.state.isParticipantGridCollapsed && (
                <Button
                  circular
                  icon
                  size="mini"
                  onClick={() => this.scrollParticipantGrid('right')}
                  className={`${styles.scrollArrow} ${styles.scrollArrowRight}`}
                  title="Scroll right"
                >
                  <Icon name="chevron right" />
                </Button>
              )}

            <div
              className={styles.participantGrid}
              ref={this.participantGridRef}
              onScroll={this.handleParticipantGridScroll}
            >
              <div
                style={{ display: 'inline-flex', gap: '8px', minWidth: '100%' }}
              >
                {audioParticipants.map((participant) => (
                  <div
                    key={participant.id}
                    className={`${styles.participantCard} ${participant.isMuted ? styles.muted : styles.unmuted}`}
                  >
                    <div>
                      <img
                        src={
                          this.props.pictureMap[participant.id] ||
                          getDefaultPicture(
                            this.props.nameMap[participant.id],
                            getColorForStringHex(participant.id),
                          )
                        }
                        alt={
                          this.props.nameMap[participant.id] || participant.id
                        }
                        className={styles.participantAvatar}
                      />
                    </div>
                    <div className={styles.participantName}>
                      {this.props.nameMap[participant.id] || participant.id}
                    </div>
                    <div className={styles.participantStatus}>
                      <Icon
                        name={
                          participant.isMuted
                            ? 'microphone slash'
                            : 'microphone'
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Helper function to determine if messages should be grouped
  shouldGroupMessages = (
    currentMsg: ChatMessage,
    previousMsg: ChatMessage | null,
  ): boolean => {
    if (!previousMsg) return false;
    if (currentMsg.id !== previousMsg.id) return false;
    if (currentMsg.cmd || previousMsg.cmd) return false; // Don't group system messages

    // Group messages within 2 minutes for tighter grouping
    const timeDiff =
      new Date(currentMsg.timestamp).getTime() -
      new Date(previousMsg.timestamp).getTime();
    return timeDiff < 2 * 60 * 1000; // 2 minutes in milliseconds
  };

  // Helper function to determine if we should show a date divider
  shouldShowDateDivider = (
    currentMsg: ChatMessage,
    previousMsg: ChatMessage | null,
  ): boolean => {
    if (!previousMsg) return false;

    const currentDate = new Date(currentMsg.timestamp).toDateString();
    const previousDate = new Date(previousMsg.timestamp).toDateString();

    return currentDate !== previousDate;
  };

  render() {
    // Process messages for grouping
    const processedMessages = this.props.chat.map((msg, index) => {
      const previousMsg = index > 0 ? this.props.chat[index - 1] : null;
      const isGrouped = this.shouldGroupMessages(msg, previousMsg);

      return {
        ...msg,
        isGrouped,
        showDivider: this.shouldShowDateDivider(msg, previousMsg),
      };
    });

    return (
      <div
        className={this.props.className}
        style={{
          display: this.props.hide ? 'none' : 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          marginTop: 0,
          marginBottom: 0,
          backgroundColor: '#1a1d21',
        }}
      >
        <div
          className={styles.slackChatContainer}
          ref={this.messagesRef}
          style={{ position: 'relative' }}
        >
          {processedMessages.map((msg, index) => (
            <React.Fragment key={msg.timestamp + msg.id}>
              {msg.showDivider && <div className={styles.slackDivider} />}
              <SlackChatMessage
                className={
                  msg.id === this.state.reactionMenu.selectedMsgId &&
                  msg.timestamp === this.state.reactionMenu.selectedMsgTimestamp
                    ? classes.selected
                    : ''
                }
                message={msg}
                pictureMap={this.props.pictureMap}
                nameMap={this.props.nameMap}
                formatMessage={this.formatMessage}
                owner={this.props.owner}
                socket={this.props.socket}
                isChatDisabled={this.props.isChatDisabled}
                setReactionMenu={this.setReactionMenu}
                handleReactionClick={this.handleReactionClick}
                isGrouped={msg.isGrouped}
              />
            </React.Fragment>
          ))}
          {!this.state.isNearBottom && (
            <Button
              size="tiny"
              onClick={this.scrollToBottom}
              style={{
                position: 'sticky',
                bottom: 0,
                display: 'block',
                margin: '0 auto',
                backgroundColor: '#2d3235',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              Jump to bottom
            </Button>
          )}
        </div>
        {this.renderAudioChatSection()}
        <Separator />
        {this.state.isPickerOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '60px',
              zIndex: 1000,
              maxHeight: '300px',
              overflow: 'hidden',
            }}
          >
            <Picker
              data={data}
              theme="dark"
              previewPosition="none"
              maxFrequentRows={2}
              perLine={8}
              emojiSize={20}
              emojiTooltip={true}
              emojiButtonSize={30}
              onEmojiSelect={this.addEmoji}
              onClickOutside={() => this.setState({ isPickerOpen: false })}
              set="native"
              categories={[
                'people',
                'nature',
                'foods',
                'activity',
                'places',
                'objects',
                'symbols',
              ]}
              categoriesIcons={{
                people: { src: '😀' },
                nature: { src: '🌿' },
                foods: { src: '🍎' },
                activity: { src: '⚽' },
                places: { src: '🏠' },
                objects: { src: '💡' },
                symbols: { src: '❤️' },
              }}
            />
          </div>
        )}
        {this.state.isGifPickerOpen && (
          <div
            style={{
              position: 'fixed',
              bottom: '60px',
              height: '350px',
              width: '280px',
              backgroundColor: '#1b1c1d',
              border: '1px solid #333',
              borderRadius: '4px',
              padding: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '10px',
                width: '100%',
                justifyContent: 'space-between',
              }}
            >
              <Input
                fluid
                placeholder="Search for GIFs..."
                value={this.state.gifSearchQuery}
                onChange={this.updateGifSearchQuery}
                inverted
                style={{ marginRight: '10px', width: '100%' }}
              />
              <Icon
                name="close"
                inverted
                circular
                link
                onClick={() =>
                  this.setState({ isGifPickerOpen: false, gifSearchQuery: '' })
                }
                style={{ opacity: 1 }}
              />
            </div>
            <div
              style={{
                height: '300px',
                overflow: 'auto',
              }}
            >
              <Grid
                onGifClick={(gif, e) => {
                  e.preventDefault();
                  const gifMarkdown = `![${gif.title}](${gif.images.downsized.url})`;
                  // If there's existing text, add the GIF and send, otherwise just send the GIF
                  const finalMessage = this.state.chatMsg
                    ? this.state.chatMsg + ' ' + gifMarkdown
                    : gifMarkdown;
                  this.setState(
                    {
                      chatMsg: finalMessage,
                      isGifPickerOpen: false,
                      gifSearchQuery: '',
                    },
                    () => {
                      // Send the message after state is updated
                      this.sendChatMsg();
                      // Scroll to bottom after sending, accounting for image load
                      setTimeout(() => this.scrollToBottomWithImageLoad());
                    },
                  );
                }}
                fetchGifs={() =>
                  this.state.gifSearchQuery.trim()
                    ? gf.search(this.state.gifSearchQuery, { limit: 20 })
                    : gf.trending({ limit: 20 })
                }
                width={260}
                columns={3}
                gutter={6}
                noLink={true}
                hideAttribution={true}
                key={this.state.gifSearchQuery} // Force re-render when search changes
              />
            </div>
          </div>
        )}
        <CSSTransition
          in={this.state.reactionMenu.isOpen}
          timeout={300}
          classNames={{
            enter: classes['reactionMenu-enter'],
            enterActive: classes['reactionMenu-enter-active'],
            exit: classes['reactionMenu-exit'],
            exitActive: classes['reactionMenu-exit-active'],
          }}
          unmountOnExit
        >
          <div
            style={{
              position: 'fixed',
              top: Math.min(
                this.state.reactionMenu.yPosition - 150,
                window.innerHeight - 450,
              ),
              left: this.state.reactionMenu.xPosition - 240,
            }}
          >
            <Picker
              data={data}
              theme="dark"
              previewPosition="none"
              maxFrequentRows={1}
              perLine={6}
              onClickOutside={() => this.setReactionMenu(false)}
              onEmojiSelect={(emoji: any) => {
                this.handleReactionClick(emoji.native);
                this.setReactionMenu(false);
              }}
            />
          </div>
          {/* <ReactionMenu
            handleReactionClick={this.handleReactionClick}
            closeMenu={() => this.setReactionMenu(false)}
            yPosition={this.state.reactionMenu.yPosition}
            xPosition={this.state.reactionMenu.xPosition}
          /> */}
        </CSSTransition>
        <div className={styles.slackInputContainer}>
          <div className={styles.slackInputWrapper}>
            <Form autoComplete="off">
              <Input
                fluid
                onKeyPress={(e: any) => e.key === 'Enter' && this.sendChatMsg()}
                onChange={this.updateChatMsg}
                value={this.state.chatMsg}
                error={this.chatTooLong()}
                disabled={this.props.isChatDisabled}
                placeholder={
                  this.props.isChatDisabled
                    ? 'The chat was disabled by the room owner.'
                    : 'Message'
                }
                className={styles.slackInput}
              />
              <div className={styles.slackInputActions}>
                <Icon
                  onClick={() => {
                    // Add a delay to prevent the click from triggering onClickOutside
                    const curr = this.state.isPickerOpen;
                    setTimeout(
                      () => this.setState({ isPickerOpen: !curr }),
                      100,
                    );
                  }}
                  name="smile"
                  link
                  disabled={this.props.isChatDisabled}
                  className={styles.slackInputAction}
                  title="Add emoji"
                />
                <Icon
                  onClick={() =>
                    this.setState({
                      isGifPickerOpen: !this.state.isGifPickerOpen,
                    })
                  }
                  name="image"
                  link
                  disabled={this.props.isChatDisabled}
                  className={styles.slackInputAction}
                  title="Add GIF"
                />
              </div>
            </Form>
          </div>
        </div>
      </div>
    );
  }
}

const SlackChatMessage = ({
  message,
  nameMap,
  pictureMap,
  formatMessage,
  socket,
  owner,
  isChatDisabled,
  setReactionMenu,
  handleReactionClick,
  className,
  isGrouped,
}: {
  message: ChatMessage & { isGrouped?: boolean };
  nameMap: StringDict;
  pictureMap: StringDict;
  formatMessage: (cmd: string, msg: string) => React.ReactNode;
  socket: Socket;
  owner: string | undefined;
  isChatDisabled: boolean | undefined;
  setReactionMenu: (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => void;
  handleReactionClick: (value: string, id?: string, timestamp?: string) => void;
  className: string;
  isGrouped?: boolean;
}) => {
  const { user } = useContext(MetadataContext);
  const { id, timestamp, cmd, msg, system, isSub, reactions, videoTS } =
    message;
  const spellFull = 5;

  return (
    <div
      className={`${isGrouped ? styles.slackMessageGrouped : styles.slackMessage} ${className}`}
      style={{ position: 'relative' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        {/* Avatar or timestamp space for grouped messages */}
        {!isGrouped && id && (
          <img
            src={
              pictureMap[id] ||
              getDefaultPicture(nameMap[id], getColorForStringHex(id))
            }
            alt={nameMap[id] || id}
            className={styles.slackAvatar}
            style={{ alignSelf: 'flex-start' }}
          />
        )}

        {/* Empty space for grouped messages to maintain alignment */}
        {isGrouped && (
          <div className={styles.slackLeftTimestamp}>
            {/* Empty - timestamp moved to message content */}
          </div>
        )}

        <div className={styles.slackMessageContent}>
          {/* Timestamp header for grouped messages */}
          {isGrouped && (
            <div className={styles.slackGroupedTimestampHeader}>
              <span className={styles.slackTimeInline}>
                {new Date(timestamp).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </span>
              {Boolean(videoTS) && (
                <span className={styles.slackVideoTimestampInline}>
                  {` @ ${formatTimestamp(videoTS)}`}
                </span>
              )}
            </div>
          )}

          {/* Message header - show username only for non-grouped messages */}
          {!isGrouped && (
            <div className={styles.slackMessageHeader}>
              <UserMenu
                displayName={nameMap[id] || id}
                timestamp={timestamp}
                socket={socket}
                userToManage={id}
                isChatMessage
                disabled={!Boolean(owner && owner === user?.uid)}
                trigger={
                  <span
                    className={`${styles.slackUsername} ${
                      isSub ? styles.slackUsernameSubscriber : ''
                    }`}
                  >
                    {Boolean(system) && 'System'}
                    {nameMap[id] || id}
                  </span>
                }
              />
              <span
                className={styles.slackTimestamp}
                title={new Date(timestamp).toLocaleDateString()}
              >
                {new Date(timestamp).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
                {Boolean(videoTS) && (
                  <span className={styles.slackVideoTimestampInline}>
                    {` @ ${formatTimestamp(videoTS)}`}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* System message */}
          {cmd && (
            <div className={styles.slackSystemMessage}>
              {formatMessage(cmd, msg)}
            </div>
          )}

          {/* Regular message content */}
          <Linkify
            componentDecorator={(
              decoratedHref: string,
              decoratedText: string,
              key: string,
            ) => (
              <SecureLink href={decoratedHref} key={key}>
                {decoratedText}
              </SecureLink>
            )}
          >
            <div
              className={`${styles.slackMessageText} ${
                isEmojiString(msg) ? styles.emoji : ''
              }`}
            >
              {!cmd && !msg?.startsWith('![') && msg}
            </div>
          </Linkify>

          {/* Image content */}
          {msg?.startsWith('![') && (
            <Markdown
              children={msg}
              components={{
                img: ({ node, ...props }) => (
                  <img
                    style={{
                      maxWidth: '280px',
                      width: '100%',
                      borderRadius: '8px',
                      marginTop: '4px',
                    }}
                    {...props}
                  />
                ),
              }}
            />
          )}

          {/* Reactions */}
          <div
            style={{
              marginTop:
                reactions && Object.keys(reactions).length > 0 ? '6px' : '0',
            }}
          >
            <TransitionGroup component={null}>
              {Object.keys(reactions ?? []).map((key) =>
                reactions?.[key].length ? (
                  <CSSTransition
                    key={key}
                    timeout={200}
                    classNames={{
                      enter: classes['reaction-enter'],
                      enterActive: classes['reaction-enter-active'],
                      exit: classes['reaction-exit'],
                      exitActive: classes['reaction-exit-active'],
                    }}
                    unmountOnExit
                  >
                    <Popup
                      content={`${reactions[key]
                        .slice(0, spellFull)
                        .map((id) => nameMap[id] || 'Unknown')
                        .concat(
                          reactions[key].length > spellFull
                            ? [`${reactions[key].length - spellFull} more`]
                            : [],
                        )
                        .reduce(
                          (text, value, i, array) =>
                            text +
                            (i < array.length - 1 ? ', ' : ' and ') +
                            value,
                        )} reacted.`}
                      offset={[0, 6]}
                      trigger={
                        <div
                          className={`${styles.slackReactionContainer} ${
                            reactions[key].includes(socket.id)
                              ? styles.highlighted
                              : ''
                          }`}
                          onClick={() =>
                            handleReactionClick(
                              key,
                              message.id,
                              message.timestamp,
                            )
                          }
                        >
                          <span className={styles.slackReactionEmoji}>
                            {key}
                          </span>
                          <span className={styles.slackReactionCount}>
                            {reactions[key].length}
                          </span>
                        </div>
                      }
                    />
                  </CSSTransition>
                ) : null,
              )}
            </TransitionGroup>
          </div>
        </div>
      </div>

      {/* React button */}
      <div
        className={styles.slackReactButton}
        onClick={(e: React.MouseEvent) => {
          const viewportOffset = (e.target as any).getBoundingClientRect();
          setTimeout(() => {
            setReactionMenu(
              true,
              id,
              timestamp,
              viewportOffset.top,
              viewportOffset.right,
            );
          }, 100);
        }}
        title="Add reaction"
      >
        <span style={{ fontSize: '16px' }}>😀</span>
      </div>
    </div>
  );
};

// class ReactionMenuInner extends React.Component<{
//   handleReactionClick: (value: string, id?: string, timestamp?: string) => void;
//   closeMenu: () => void;
//   yPosition: number;
//   xPosition: number;
// }> {
//   state = {
//     containerWidth: 0,
//   };
//   handleClickOutside = () => {
//     this.props.closeMenu();
//   };
//   containerRef = React.createRef<HTMLDivElement>();
//   componentDidMount() {
//     this.setState({ containerWidth: this.containerRef.current?.offsetWidth });
//   }
//   render() {
//     return (
//       <div
//         ref={this.containerRef}
//         className={classes.reactionMenuContainer}
//         style={{
//           top: this.props.yPosition - 9,
//           left: this.props.xPosition - this.state.containerWidth - 35,
//         }}
//       >
//         {reactionEmojis.map((reaction) => (
//           <div
//             onClick={() => {
//               this.props.handleReactionClick(reaction);
//               this.props.closeMenu();
//             }}
//             style={{ cursor: 'pointer' }}
//           >
//             {reaction}
//           </div>
//         ))}
//       </div>
//     );
//   }
// }
// const ReactionMenu = onClickOutside(ReactionMenuInner);
