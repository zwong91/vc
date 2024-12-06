"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(true); // true means listening, false means speaking
  const [isPlayingAudio, setIsPlayingAudio] = useState(false); // State to track audio playback
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [audioQueue, setAudioQueue] = useState<Blob[]>([]);
  const [currentAudioElement, setCurrentAudioElement] = useState<HTMLAudioElement | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0); // State to track audio duration
  const [connectionStatus, setConnectionStatus] = useState<string>("Connecting..."); // State to track connection status

  let audioContext: AudioContext | null = null;
  let audioBufferQueue: AudioBuffer[] = [];
  let isPlaying = false;

  if (typeof window !== "undefined" && window.AudioContext) {
    audioContext = new AudioContext();
  }

  const audioManager = {
    stopCurrentAudio: () => {
      if (currentAudioElement) {
        currentAudioElement.pause();
        currentAudioElement.currentTime = 0;
        URL.revokeObjectURL(currentAudioElement.src);
        setCurrentAudioElement(null);
        setIsPlayingAudio(false);
      }
    },

    playNewAudio: async (audioBlob: Blob) => {
      audioManager.stopCurrentAudio();

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onloadedmetadata = () => {
        setAudioDuration(audio.duration); // Set the audio duration
      };

      setCurrentAudioElement(audio);
      setIsPlayingAudio(true);

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setCurrentAudioElement(null);
        setIsPlayingAudio(false);
        setIsRecording(true);

        if (audioQueue.length > 0) {
          const nextAudioBlob = audioQueue.shift();
          if (nextAudioBlob) {
            audioManager.playNewAudio(nextAudioBlob);
          }
        }
      };

      try {
        await audio.play();
      } catch (error) {
        console.error("播放音频失败:", error);
        audioManager.stopCurrentAudio();
      }
    }
  };

  function bufferAudio(data: ArrayBuffer) {
    if (audioContext) {
      audioContext.decodeAudioData(data, (buffer) => {
        splitAndQueueAudioBuffer(buffer);
        if (!isPlaying) {
          playAudioBufferQueue();
        }
      });
    }
  }

  function splitAndQueueAudioBuffer(buffer: AudioBuffer) {
    const chunkDuration = 1; // Duration of each chunk in seconds
    const numberOfChunks = Math.ceil(buffer.duration / chunkDuration);

    for (let i = 0; i < numberOfChunks; i++) {
      const chunkStart = i * chunkDuration;
      const chunkEnd = Math.min(chunkStart + chunkDuration, buffer.duration);
      const chunkLength = chunkEnd - chunkStart;

      const chunkBuffer = audioContext!.createBuffer(
        buffer.numberOfChannels,
        chunkLength * buffer.sampleRate,
        buffer.sampleRate
      );

      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        chunkBuffer.copyToChannel(
          buffer.getChannelData(channel).subarray(chunkStart * buffer.sampleRate, chunkEnd * buffer.sampleRate),
          channel
        );
      }

      audioBufferQueue.push(chunkBuffer);
    }
  }

  function playAudioBufferQueue() {
    if (audioBufferQueue.length === 0) {
      isPlaying = false;
      setIsPlayingAudio(false); // Set the state to false when all audio has been played
      setIsRecording(true); // Ensure the state switches from 'Speaking'
      return;
    }

    isPlaying = true;
    const buffer = audioBufferQueue.shift();
    if (buffer && audioContext) {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = playAudioBufferQueue;
      source.start();
    }
  }

  type HistoryItem = [string, string]; // [用户输入, AI响应]
  type History = HistoryItem[];

  const [history, setHistory] = useState<History>([]);
  const SOCKET_URL = "wss://192.168.31.105:29999/stream-vc";

  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    async function requestWakeLock() {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        console.log("Screen wake lock acquired");
      } catch (error) {
        console.error("Failed to acquire wake lock", error);
      }
    }

    requestWakeLock();

    return () => {
      if (wakeLock) {
        wakeLock.release().then(() => {
          console.log("Screen wake lock released");
        }).catch((error) => {
          console.error("Failed to release wake lock", error);
        });
      }
    };
  }, []);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        setMediaRecorder(new MediaRecorder(stream));
      }).catch((error) => {
        console.error("Error accessing media devices.", error);
      });
    } else {
      console.error("Media devices API not supported.");
    }
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://www.WebRTC-Experiment.com/RecordRTC.js";
    script.onload = () => {
      const RecordRTC = (window as any).RecordRTC;
      const StereoAudioRecorder = (window as any).StereoAudioRecorder;

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          let websocket: WebSocket | null = null;

          const reconnectWebSocket = () => {
            if (websocket) websocket.close();
            websocket = new WebSocket(SOCKET_URL);
            setSocket(websocket);

            websocket.onopen = () => {
              console.log("client connected to websocket");
              setConnectionStatus("Connected");

              const recorder = new RecordRTC(stream, {
                type: 'audio',
                recorderType: StereoAudioRecorder,
                mimeType: 'audio/wav',
                timeSlice: 500,
                desiredSampRate: 16000,
                numberOfAudioChannels: 1,
                ondataavailable: (blob: Blob) => {
                  if (blob.size > 0) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      if (reader.result) {
                        const base64data = arrayBufferToBase64(reader.result as ArrayBuffer);

                        const dataToSend = [
                          history,
                          "xiaoxiao",
                          base64data
                        ];
                        const jsonData = JSON.stringify(dataToSend);

                        if (websocket) {
                          websocket.send(jsonData);
                        } else {
                          console.error("WebSocket is null, cannot send data.");
                        }
                      } else {
                        console.error("FileReader result is null");
                      }
                    };
                    reader.readAsArrayBuffer(blob);
                  }
                }
              });

              recorder.startRecording();
            };

            websocket.onmessage = (event) => {
              setIsRecording(false);
              setIsPlayingAudio(true);
            
              try {
                const jsonData = JSON.parse(event.data);
                const audioBase64 = jsonData["stream"];
                
                const receivedHistory: Array<{ user: string, ai: string }> = jsonData["history"];

                if (Array.isArray(receivedHistory)) {
                  // 将 List[Dict[str, str]] 转换为 HistoryItem[]
                  const formattedHistory: History = receivedHistory.map(item => [item.user, item.ai]);
                  setHistory(formattedHistory);
                }
                if (!audioBase64) {
                  console.error("No audio stream data received");
                  return;
                }

                const binaryString = atob(audioBase64);
                const bytes = new Uint8Array(binaryString.length);
                bytes.set(Uint8Array.from(binaryString, c => c.charCodeAt(0)));
                bufferAudio(bytes.buffer);
              } catch (error) {
                console.error("Error processing WebSocket message:", error);
              }
            };

            websocket.onclose = () => {
              console.log("WebSocket connection closed, attempting to reconnect...");
              setConnectionStatus("Reconnecting...");
              setTimeout(reconnectWebSocket, 5000);
            };

            websocket.onerror = (error) => {
              console.error("WebSocket error:", error);
              websocket?.close();
            };
          };

          reconnectWebSocket();
        }).catch((error) => {
          console.error("Error with getUserMedia", error);
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [mediaRecorder]);

  useEffect(() => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      if (isRecording) {
        mediaRecorder.resume();
      } else {
        mediaRecorder.pause();
      }
    }
  }, [isRecording, mediaRecorder]);

  function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
    let binary = '';
    const uint8Array = new Uint8Array(arrayBuffer);
    const len = uint8Array.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  return (
    <>
      <div className={styles.title}>AudioChat - your voice AI assistant</div>
      <div className={styles["center-vertical"]}>
        <div
          className={`${styles["speaker-indicator"]} ${styles["you-speaking"]} ${isRecording && !isPlayingAudio ? styles.pulsate : ""}`}
        ></div>
        <br />
        <div>{isRecording && !isPlayingAudio ? "Listening..." : "Speaking..."}</div>
        <br />
        <div
          className={`${styles["speaker-indicator"]} ${styles["machine-speaking"]} ${!isRecording && isPlayingAudio ? styles.pulsate : ""}`}
        ></div>
        <br />
        <div>当前音频时长: {audioDuration.toFixed(2)} 秒</div>
        <br />
        <div>WebSocket状态: {connectionStatus}</div>
      </div>
    </>
  );
}
