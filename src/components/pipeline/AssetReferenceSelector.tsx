import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Puzzle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export interface AssetReference {
  id: string;
  name: string;
  description: string;
  category: string | null;
  image_url: string;
}

interface AssetReferenceSelectorProps {
  selectedAssets: AssetReference[];
  onSelectionChange: (assets: AssetReference[]) => void;
}

export function AssetReferenceSelector({ selectedAssets, onSelectionChange }: AssetReferenceSelectorProps) {
  const [assets, setAssets] = useState<AssetReference[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchAssets = async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, name, description, category, image_url')
        .order('name');
      if (!error && data) {
        setAssets(data.filter(a => a.description && a.description.trim() !== '') as AssetReference[]);
      }
    };
    fetchAssets();
  }, []);

  const toggleAsset = (asset: AssetReference) => {
    const isSelected = selectedAssets.some(a => a.id === asset.id);
    if (isSelected) {
      onSelectionChange(selectedAssets.filter(a => a.id !== asset.id));
    } else {
      onSelectionChange([...selectedAssets, asset]);
    }
  };

  if (assets.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Puzzle className="h-3 w-3" />
          Assets
          {selectedAssets.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {selectedAssets.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <p className="text-xs text-muted-foreground px-2 pb-2">
          Selecione assets como referência visual para as imagens geradas
        </p>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {assets.map(asset => {
            const isSelected = selectedAssets.some(a => a.id === asset.id);
            return (
              <label
                key={asset.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleAsset(asset)}
                />
                <img
                  src={asset.image_url}
                  alt={asset.name}
                  className="h-8 w-8 rounded object-cover flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{asset.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{asset.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
