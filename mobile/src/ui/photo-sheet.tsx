// The photo picker sheet: take or pick photos, see thumbnails, remove them,
// and open the full image (online, or the local file before upload).
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from "react-native";
import { capturePhoto, type FormPhoto, PhotoPermissionError } from "../photos/photos";
import { fullImageUrl } from "../sync/photo-sync";
import { Button, Sheet } from "./components";
import { colors } from "./theme";

export function Thumb({ photo, size = 96, onPress }: { photo: FormPhoto | { thumbUri: string | null }; size?: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, borderRadius: 8, overflow: "hidden", backgroundColor: "#dfe2e8" }}>
      {photo.thumbUri ? (
        <Image source={{ uri: photo.thumbUri }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="image-outline" size={28} color={colors.muted} />
        </View>
      )}
    </Pressable>
  );
}

// Full-size view, fetched only when opened.
export function FullImage({ bucket, path, onClose }: { bucket: string; path: string | null; onClose: () => void }) {
  // The result for the path it was fetched for; another path shows loading.
  const [result, setResult] = useState<{ path: string; url: string | null } | null>(null);
  const url = result && result.path === path ? result.url : null;
  const failed = !!result && result.path === path && !result.url;
  useEffect(() => {
    if (!path) return;
    let live = true;
    fullImageUrl(bucket, path)
      .then((u) => live && setResult({ path, url: u }))
      .catch(() => live && setResult({ path, url: null }));
    return () => {
      live = false;
    };
  }, [bucket, path]);
  return (
    <Modal visible={!!path} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center" }}>
        {url ? (
          <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="contain" />
        ) : failed ? (
          <Text style={{ color: "#fff", textAlign: "center", fontSize: 17, padding: 24 }}>The full image can be opened when you are online.</Text>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
        <Pressable onPress={onClose} style={{ position: "absolute", top: 48, right: 20 }} accessibilityLabel="Close">
          <Ionicons name="close" size={32} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

export function PhotoSheet({
  open,
  title,
  photos,
  onChange,
  onClose,
  userId,
  bucket,
  required,
}: {
  open: boolean;
  title: string;
  photos: FormPhoto[];
  onChange: (fn: (prev: FormPhoto[]) => FormPhoto[]) => void;
  onClose: () => void;
  userId: string;
  bucket: string;
  required?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  async function add(source: "camera" | "library") {
    setBusy(true);
    try {
      const p = await capturePhoto(source, userId);
      if (p) onChange((prev) => [...prev, p]);
    } catch (e) {
      Alert.alert("Photo", e instanceof PhotoPermissionError ? e.message : "Couldn't use that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function remove(p: FormPhoto) {
    Alert.alert("Remove photo", "Remove this photo from the form?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onChange((prev) => prev.filter((x) => x.key !== p.key)) },
    ]);
  }

  return (
    <Sheet open={open} title={title} onClose={onClose} footer={<Button title="Save & Close" onPress={onClose} style={{ flex: 1 }} />}>
      <View style={{ padding: 16, gap: 16 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button title="Camera" icon="camera" kind="dark" onPress={() => add("camera")} disabled={busy} style={{ flex: 1 }} />
          <Button title="Gallery" icon="images" kind="light" onPress={() => add("library")} disabled={busy} style={{ flex: 1 }} />
        </View>
        {busy && <ActivityIndicator color={colors.brand} />}
        {required !== undefined && required > 0 && (
          <Text style={{ fontSize: 16, color: photos.length < required ? colors.orange : colors.muted }}>
            {photos.length} / {required} required
          </Text>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {photos.map((p) => (
            <View key={p.key}>
              <Thumb photo={p} onPress={() => setViewing(p.storage_path || null)} />
              <Pressable
                onPress={() => remove(p)}
                accessibilityLabel="Remove photo"
                style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, padding: 2 }}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
        {photos.length === 0 && <Text style={{ fontSize: 16, color: colors.muted }}>No Images Taken</Text>}
      </View>
      <FullImage bucket={bucket} path={viewing} onClose={() => setViewing(null)} />
    </Sheet>
  );
}
